// api/lib/soc-pipeline.js
// SOC pipeline: claim extraction, professional drafting, completeness audit.

export const CLAIM_BATCH_NOTES    = 20;
export const MAX_CLAIMS_PER_BATCH = 25;
export const QUALITY_ROW_BATCH    = 15;
export const FIDELITY_ROW_BATCH   = 10;

// ─── Speech-to-text correction rules ──────────────────────────────────────────
const STT_CORRECTIONS = [
  [/bugatti wall/gi,        'party wall'],
  [/plank wall/gi,          'flank wall'],
  [/blank wall/gi,          'flank wall'],
  [/\bv[\s-]?locks?\b/gi,   'VELUX'],
  [/velocks?\b/gi,           'VELUX'],
  [/\bsealing\b/g,          'ceiling'],
  [/real evasion wall/gi,   'rear elevation wall'],
  [/rear evasion wall/gi,   'rear elevation wall'],
  [/kitched roof/gi,        'pitched roof'],
  [/tarps? floor/gi,        'tiled floor'],
  [/\bUPBC\b/g,             'UPVC'],
  [/\bscheduler\b/g,        'schedule'],
  // False-start correction: "starting the extension, starting the schedule... rear outrigger"
  // The word "extension" before a schedule declaration followed by "outrigger" is a false start
  [/starting the extension[,.]?\s*starting the schedule of conditions in the/gi, 'starting the schedule of conditions in the'],
  [/starting the extension[,.]?\s*(ground floor rear outrigger|rear outrigger)/gi, '$1'],
];

export function applySttCorrections(text) {
  let out = text || '';
  for (const [pattern, replacement] of STT_CORRECTIONS) out = out.replace(pattern, replacement);
  return out;
}

// ─── Navigation phrase filter ─────────────────────────────────────────────────
const NAVIGATION_PATTERNS = [
  /continuing (the )?schedul/i,
  /we('re| are) (now |)(?:moving|starting|entering|going|heading)/i,
  /standing (inside|in|at)/i,
  /^(okay|ok)(,|\s)/i,
  /^(so|and) (now|continuing|moving|we)/i,
  /^(now |)facing the/i,
  /^(just |)(to note|going back|returning|moving temporarily|i'?m (just|now))/i,
  /off the .{3,40} we now enter/i,
  /dictate or type/i,
];

export function isNavigationPhrase(text) {
  const t = (text || '').trim();
  if (t.length < 8) return false;
  return NAVIGATION_PATTERNS.some(p => p.test(t));
}

// ─── Canonical section names ───────────────────────────────────────────────────
const SECTION_ALIASES = {
  'ground floor front elevation': 'Ground Floor Front Elevation Room',
  'internal front elevation':     'Ground Floor Front Elevation Room',
  'front elevation room':         'Ground Floor Front Elevation Room',
  'ground floor rear elevation':  'Ground Floor Rear Elevation Room',
  'existing rear room':           'Ground Floor Rear Elevation Room',
  'rear elevation room':          'Ground Floor Rear Elevation Room',
  'existing rear elevation':      'Ground Floor Rear Elevation Room',
  // 'ground floor' alias removed — too broad, was forcing Ground Floor Rear Outrigger
  // and any other ground floor section into Ground Floor Rear Extension incorrectly.
  // The title-case fallback in canonicalSection() handles unmatched names correctly.
  'extended area':                'Rear Extension',
  'rear extension':               'Rear Extension',
  'first floor rear bedroom':     'First Floor Rear Bedroom',
  'first floor rear bathroom':    'First Floor Rear Bathroom',
  // 'rear bedroom' alias removed — was forcing all rear bedroom references to First Floor
  // regardless of the actual floor level dictated. Specific 'first floor rear bedroom'
  // alias above handles the first-floor case; ground floor rear bedroom falls through
  // to the title-case fallback which preserves the correct name.
  'first floor front elevation':  'First Floor Front Elevation Room',
  'external':                     'External Areas',
  'external areas':               'External Areas',
};

export function canonicalSection(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  for (const [key, val] of Object.entries(SECTION_ALIASES)) {
    if (lower.includes(key)) return val;
  }
  return raw.trim().replace(/\b\w/g, l => l.toUpperCase());
}

// ─── Stage 1: Structured claim extraction ─────────────────────────────────────
export async function extractAtomicClaims(rawNotes, apiKey) {
  const corrected = applySttCorrections(rawNotes);
  const lines = corrected.split(/\n+/).filter(l => l.trim());
  let allClaims = [], currentSection = null;

  for (let i = 0; i < lines.length; i += CLAIM_BATCH_NOTES) {
    const batch = lines.slice(i, i + CLAIM_BATCH_NOTES);
    const batchNum = Math.floor(i / CLAIM_BATCH_NOTES) + 1;
    const totalBatches = Math.ceil(lines.length / CLAIM_BATCH_NOTES);
    console.log(`[soc-pipeline] Extraction batch ${batchNum}/${totalBatches}`);

    const batchClaims = await _extractBatch(batch.join('\n'), currentSection, apiKey);
    const lastWithSection = [...batchClaims].reverse().find(c => c.section && c.status !== 'contextual');
    if (lastWithSection?.section) currentSection = lastWithSection.section;
    allClaims = allClaims.concat(batchClaims);
  }

  return allClaims
    .filter(c => c.claim_type !== 'section_transition')
    .map(c => ({ ...c, section: canonicalSection(c.section) || c.section }));
}

const EXTRACTION_SYSTEM = `You are extracting structured factual claims from Party Wall site inspection notes.

CRITICAL: Store FACTS in structured fields. Do NOT write finished prose sentences. The fields are the factual record, not draft wording.

SPEECH-TO-TEXT CORRECTIONS (apply automatically):
"bugatti wall" → "party wall" | "plank wall"/"blank wall" → "flank wall" | "v-locks"/"velocks" → "VELUX"
"sealing" (ceiling context) → "ceiling" | "real evasion wall" → "rear elevation wall"
"kitched roof" → "pitched roof" | "tarps floor" → "tiled floor" | "UPBC" → "UPVC"

SECTION NAMES — use exactly:
Ground Floor Front Elevation Room | Ground Floor Rear Elevation Room | Ground Floor Rear Outrigger | Ground Floor Rear Outrigger Kitchen | Ground Floor Rear Bedroom | Ground Floor Hallway | Ground Floor Rear Extension | First Floor Rear Bedroom | First Floor Rear Bathroom | First Floor Front Elevation Room | External Areas

SECTION ASSIGNMENT RULES — CRITICAL:
- Use "Ground Floor Rear Extension" ONLY if the surveyor explicitly uses the word "extension" or "rear extension" to describe the area. Do NOT default to this section when the area could be an outrigger, corridor, hallway or any other ground floor space.
- Use "Ground Floor Rear Outrigger" when the surveyor says "outrigger".
- Use "Ground Floor Hallway" when the surveyor describes a hallway, corridor or passageway without naming it as an extension or outrigger.
- If the surveyor does not name the section explicitly, use the most specific description available from the dictation. Do not guess "Ground Floor Rear Extension" as a default.

FLOOR LEVEL RULES — CRITICAL:
- Never infer or assume a floor level that was not explicitly stated.
- If the surveyor says "rear bedroom" with no floor level, the section is "Rear Bedroom" — not "First Floor Rear Bedroom".
- If the surveyor says "kitchen on the first floor" or "entering the kitchen on the first floor", the section is "First Floor Kitchen" — even though kitchens are traditionally ground floor.
- Never apply traditional house layout assumptions. Townhouses, maisonettes and inverted layouts exist.
- The surveyor's stated floor level is always correct. If no floor level is stated, omit it entirely from the section name.

SELF-CORRECTION / FALSE STARTS — critical rule:
When a speaker starts a phrase and immediately corrects themselves in the same sentence or next breath, ignore the false start entirely and use only the corrected version.
Examples:
- "Starting the extension, starting the schedule of conditions in the ground floor rear outrigger" → section is "Ground Floor Rear Outrigger", ignore "starting the extension"
- "first floor rear bedroom, rear bathroom" → section is "First Floor Rear Bathroom", ignore "rear bedroom"
- Any phrase of the form "[false start], [correction]" where the correction is a fuller or more specific description — use the correction only.

NAVIGATION PHRASES → section_transition or contextual, never observations.

AMENDMENT DETECTION — these phrases signal a correction to a PREVIOUS note:
- "Actually..." / "scratch that" / "correction" / "just to amend"
- "just to note on that last one" / "just to note on the last one"
- "going back to" / "to clarify the last" / "to correct the last"

When you detect any of these, the current note is correcting a claim from a previous note.
Mark the relevant previous claim as status="superseded" with superseded_by pointing to the new claim_id.
The corrected claim is status="active".
NEVER leave two active claims covering the same element where one corrects the other.
For the 500mm crack: "intermittently" was corrected out — active claim must NOT contain it.
SCOPE REFINEMENT vs FULL REPLACEMENT — CRITICAL:
When an amendment narrows one attribute of a previous claim (e.g. "just to note on that last one, we're talking about the ground floor" narrows the floor level), it is a SCOPE REFINEMENT — update only the narrowed attribute and preserve all other attributes of the original claim.
A scope refinement must NEVER remove elements that were not part of the correction.
Example: "both chimney breasts on the front and rear removed" followed by "just to note on that last one, talking about the ground floor" — the correction narrows to ground floor only. It does NOT remove "front and rear". Active claim must retain both: ground floor front AND rear chimney breasts removed.
Only mark a claim as fully superseded when the amendment explicitly replaces the entire substance.

SECTION NAMING: Use the room name exactly as the surveyor described it. Do not apply architectural terminology (e.g. 'outrigger', 'annexe', 'extension') unless the surveyor used those exact words. If the surveyor said 'rear kitchen' use 'Rear Kitchen'. If they said 'kitchen family room' use 'Ground Floor Rear Kitchen Family Room'.

CLAIM TYPE RULES — site_note vs scheduled observation:

Use claim_type: "site_note" for:
- Access arrangements: keys, key safes, how access was gained, who let you in
- Security/locking status at commencement AND at the end of inspection (e.g. "door found locked at commencement, confirmed locked on leaving")
- General property context that is NOT a defect or condition (e.g. "the whole property has recently been refurbished", "the property appeared recently renovated")
- Scaffolding requirements or restrictions
- Instructions to contractors about protection, precautions or sequencing
- Windows or doors left in a specific position at the end of inspection
- Key return or access handover notes
- Any note the surveyor explicitly flags as "just as a side note" or "for the award" or "to note"

Use claim_type: "general_condition" (scheduled row) ONLY for:
- Specific observable physical conditions of the property elements
- Defects, cracks, open joints, staining, deterioration
- Operational tests of specific elements (windows, doors, mechanisms)
- Construction descriptions relevant to the party wall

If a statement is procedural, administrative or contextual rather than a physical observation — it is a site_note.

CLAIM TYPES: section_transition | construction_description | finish_description | general_condition | specific_defect | operational_test | access_limitation | site_note | contextual | amendment

Return JSON only: { "claims": [ ... ] }`;

function _extractBatch(notesText, carrySection, apiKey) {
  const sectionCtx = carrySection ? `CURRENT ACTIVE SECTION: ${carrySection}\n\n` : '';
  const prompt = `${sectionCtx}Extract atomic structured claims. Each claim:
{
  "claim_id": "c-N-M", "source_note_id": N, "note_sequence": N, "claim_sequence": M,
  "claim_type": "...", "section": "canonical section name",
  "element": "specific element", "construction": null, "finish": null,
  "condition": null, "defect_type": null, "location": null, "direction": null,
  "measurement": null, "extent": null, "operational_result": null, "access_limitation": null,
  "raw_fragment": "corrected verbatim text from note",
  "status": "active|superseded|contextual",
  "amendment_mode": null, "superseded_by": null, "confidence": "high|medium|low"
}

NOTES:
${notesText}`;

  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5.6-luna', max_completion_tokens: 16000,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
  })
  .then(async r => {
    const d = await r.json();
    if (!r.ok || d.error) { console.error('[soc-pipeline] OpenAI error status=' + r.status + ':', JSON.stringify(d.error || d)); return []; }
    const raw = (d.choices?.[0]?.message?.content || '').replace(/^[`]{3}(?:json)?\s*/m, '').replace(/\s*[`]{3}$/m, '').trim();
    if (!raw) { console.error('[soc-pipeline] Empty response from OpenAI model=gpt-5.6-luna'); return []; }
    try { return JSON.parse(raw).claims || []; } catch(e) { console.error('[soc-pipeline] JSON parse failed:', e.message, 'raw:', raw.slice(0, 200)); return []; }
  })
  .catch(e => { console.error('[soc-pipeline] fetch error:', e.message); return []; });
}

// ─── Build factual checklist for drafting (not database labels) ────────────────
function buildFactualChecklist(claims, rawNotesBySeq) {
  const contextualTypes = new Set(['contextual', 'section_transition', 'award_note']);
  const activeClaims = claims.filter(c => c.status === 'active' && !contextualTypes.has(c.claim_type));
  const supersededClaims = claims.filter(c => c.status === 'superseded');

  const lines = [];

  // Group claims by note sequence for better context
  const byNote = {};
  for (const c of activeClaims) {
    const seq = c.note_sequence || c.source_note_id || 0;
    if (!byNote[seq]) byNote[seq] = [];
    byNote[seq].push(c);
  }

  for (const [noteSeq, noteClaims] of Object.entries(byNote)) {
    const rawNote = rawNotesBySeq?.[noteSeq] || '';

    for (const c of noteClaims) {
      const facts = [];
      if (c.element)            facts.push(`Element: ${c.element}`);
      if (c.construction && c.finish) facts.push(`Construction and finish: ${c.construction}, ${c.finish}`);
      else if (c.construction)  facts.push(`Construction: ${c.construction}`);
      else if (c.finish)        facts.push(`Finish: ${c.finish}`);
      if (c.condition)          facts.push(`General condition: ${c.condition}`);
      if (c.defect_type)        facts.push(`Defect: ${c.defect_type}`);
      if (c.location)           facts.push(`Location: ${c.location}`);
      if (c.direction)          facts.push(`Direction: ${c.direction}`);
      if (c.measurement)        facts.push(`Measurement: ${c.measurement}`);
      if (c.extent)             facts.push(`Extent: ${c.extent}`);
      if (c.operational_result) facts.push(`Test result: ${c.operational_result}`);
      if (c.access_limitation)  facts.push(`Access limitation: ${c.access_limitation}`);

      lines.push(`[${c.claim_id}] ${c.claim_type}`);
      for (const f of facts) lines.push(`  - ${f}`);
      if (c.raw_fragment)       lines.push(`  Raw: "${c.raw_fragment}"`);
      if (c.amendment_mode)     lines.push(`  Amendment: ${c.amendment_mode}`);
      lines.push('');
    }

    if (rawNote && activeClaims.some(c => (c.note_sequence||c.source_note_id) == noteSeq)) {
      // Raw note already embedded in raw_fragment per claim
    }
  }

  if (supersededClaims.length) {
    lines.push('--- SUPERSEDED CLAIMS — DO NOT USE IN FINAL WORDING ---');
    for (const c of supersededClaims) {
      lines.push(`[${c.claim_id}] SUPERSEDED: ${c.raw_fragment || c.content || ''}`);
    }
  }

  return lines.join('\n');
}

// ─── Few-shot examples calibrating the professional standard ──────────────────
const FEW_SHOT_EXAMPLES = `EXAMPLES OF REQUIRED PROFESSIONAL STANDARD
==========================================

PREFERRED TERMINOLOGY — always use these terms where applicable:

- "Plaster and emulsion finish" — standard phrasing for painted plaster (walls/ceilings). NOT "plaster paint finish" or generic "paint finish".
- "Segmental brick arch" — a curved brick arch spanning an opening, bricks laid on edge following the curve, as opposed to a flat/horizontal lintel.
- "Perished pointing" — for loose, crumbling, or missing mortar pointing. NOT "loose and friable mortar" or "missing pointing".
- "Perished brickwork" / "localised perished brickwork" — for deteriorated, crumbling, or flaking brick faces. NOT "spalling" or "localised spalling".
- "Stepped crack" — a crack that follows the mortar joints in a zig-zag pattern rather than running straight through brick or render.
- "Slight inward lean" / "slight outward lean" — for masonry (parapets, walls, piers) showing a lean out of true.
- "Render appeared blown at [location]" — for render that has detached/hollowed from the substrate.
- "Not visible from ground level" — standard limitation phrase when an element could not be inspected due to height/access.
- "Detailed inspection limited by vantage point" — standard limitation phrase for hard-to-reach elements (chimneys, high-level roofwork) that were visible but not closely inspectable.
- "Appeared serviceable from ground level" — qualifier for elements seen but not closely inspected, where no obvious defects were visible.
- "Inspection was partially restricted by stored contents" — for cupboards/storage areas where full inspection was not possible.
- Do NOT use "heavily weathered and over-rendered" or similar vague weathering descriptions — be specific (perished, blown, spalled-equivalent perished brickwork, etc.) rather than generic.

---

EXAMPLE 1 — Room context and construction/finish/condition

Raw dictation: "party wall plaster paint finish no visible defects"
Facts:
  • Element: Party wall
  • Construction and finish: Plastered and painted
  • General condition: No visible defects

Required row:
"The party wall is finished in a plaster skim coat with emulsion paint decoration. No visible defects were noted at the time of inspection."

CRITICAL: Never write bare "plaster and paint finish" without identifying the construction material first and stating condition explicitly. Compare:
BAD: "The party wall is finished in plaster and paint."
GOOD: "The party wall is finished in a plaster skim coat with emulsion paint decoration. No visible defects were noted at the time of inspection."
BAD: "The ceiling is plasterboard with no issues."
GOOD: "The ceiling is of plasterboard construction with a smooth skim coat finish. No visible defects were noted at the time of inspection."
BAD: "The walls have wallpaper with no defects."
GOOD: "The walls have wallpaper-lined finishes. No visible defects were noted at the time of inspection."

---

EXAMPLE 2 — Section introduction with layout context and scope refinement amendment

Raw dictation: "front elevation is an open plan that extends into the extension, both chimney breasts on the front and rear removed. just to note on that last one talking about ground floor front chimney breast"
Facts:
  • claim_type: contextual/construction_description
  • Layout: open-plan arrangement extending to rear
  • Element: Chimney breasts (front and rear)
  • Amendment type: SCOPE REFINEMENT — "just to note on that last one" narrows to ground floor only, does NOT remove "front and rear"
  • Condition: Ground-floor front AND rear chimney breasts removed

Required row:
"The ground floor front reception room forms part of an open-plan arrangement extending through to the rear of the property and into the later rear extension. The original ground-floor front and rear elevation chimney breasts have been removed."

---

EXAMPLE 3 — Window operational test

Raw dictation: "window opens a bit then sticks on the frame, can't open it past the frame itself"
Facts:
  • Element: Window opener nearest party wall
  • Test result: Opens partially
  • Defect type: Binds against frame
  • Effect: Cannot open fully

Required row:
"The window opener closest to the party wall was tested and opened partially but bound against the frame, preventing it from opening fully."

---

EXAMPLE 4 — Crack description with location, direction and measurement

Raw dictation: "two hairline cracks left-hand corner one running diagonally up towards ceiling another running vertically from top left-hand corner up towards ceiling"
Facts:
  • Element: Rear elevation wall
  • Defect type: Hairline cracks (×2)
  • Location: Left-hand corner
  • Direction 1: Diagonal, upward towards ceiling
  • Direction 2: Vertical, upward towards ceiling

Required row:
"Two hairline cracks were noted within the left-hand corner of the rear elevation wall. One crack extends diagonally upward towards the ceiling whilst a second crack extends vertically upward from the same corner towards the ceiling junction."

---

EXAMPLE 5 — Amendment applied (500mm crack — intermittently removed)

Superseded (DO NOT USE): "hairline crack running intermittently approximately 500mm"
Active fact:
  • Defect type: Hairline crack
  • Measurement: Approximately 500mm
  • Location: Junction of pitched ceiling and flat roof ceiling, approximately 2m from French doors
  • Direction: Extends towards rear elevation
  • Amendment: "intermittently" corrected out

Required row:
"A further hairline crack was noted approximately 2.0 metres from the French doors, extending approximately 500mm along the junction between the pitched ceiling and flat roof ceiling."

---

EXAMPLE 6 — Access limitation

Raw dictation: "party wall of the rear bedroom is enclosed upon with floor-to-ceiling wardrobes, sections accessible in corner, no visible defects noted in bottom wardrobe section"
Facts:
  • Element: Party wall
  • Access limitation: Enclosed by floor-to-ceiling fitted wardrobes
  • Accessible: Sections in corner of party wall and rear elevation
  • Condition of accessible sections: No visible defects

Required row:
"The majority of the party wall is enclosed by fitted floor-to-ceiling wardrobes. Accessible sections of the party wall and rear elevation wall within the lower cupboard areas were inspected and no visible defects were noted."

---

EXAMPLE 7 — Water ingress with remote-from-works note

Raw dictation: "although remote from notifiable works on the wall abutting the bathroom there are signs of water ingress, appears to be dry now"
Facts:
  • Element: Wall abutting bathroom
  • Defect type: Water ingress (historic)
  • Current condition: Appeared dry at time of inspection
  • Context: Remote from notifiable works

Required row:
"Although remote from the proposed notifiable works, signs of historic water ingress were observed to the wall abutting the bathroom. The affected area appeared dry at the time of inspection and has been recorded for scheduling purposes only."

---

EXAMPLE 8 — Roof and guttering (External Areas — must be included)

Raw dictation: "pitch roof over extension appears to be in good condition no visible defects noted to roof tiles with a gutter overhanging the bottom of the pitch roof leading to a flat roof again no visible defects noted on the flat roof itself or surrounding upstand of the skylight over the extension"
Facts:
  • Element: Pitched roof tiles
  • Condition: No visible defects
  • Element: Gutter at base of pitched roof
  • Condition: No visible defects
  • Element: Flat roof covering
  • Condition: No visible defects
  • Element: Rooflight/skylight upstand
  • Condition: No visible defects
  • CRITICAL: These are External Area observations and must appear in External Areas section, not Ground Floor Rear Extension

Required rows (External Areas):
"No visible defects were noted to the pitched roof tiles above the rear extension."
"The guttering at the base of the pitched roof appeared free from visible defects."
"No visible defects were noted to the flat roof covering over the extension or to the surrounding rooflight upstand."

---

EXAMPLE 8b — Engineering bricks and external open joint

Raw dictation: "two courses of engineering bricks above the patio with cement residue on the floor. open joint at junction of cement fillet and rear elevation, extends toward building owner side, continues to edge of downpipe gully"
Facts:
  • Element: Engineering bricks (NOT "engineered bricks")
  • Element: Open joint at cement fillet
  • Route: From base of brickwork → towards Building Owner → to edge of rainwater downpipe gully

Required rows:
"Two courses of engineering bricks sit above the patio level. Signs of cement residue were noted on the patio surface at this location."
"An open joint was noted at the junction between the cement fillet and rear elevation wall to the right-hand side of the French doors. The joint extends from the base of the brickwork towards the Building Owner's side and continues to the edge of the rainwater downpipe gully."

---

EXAMPLE 9 — External paving

Raw dictation: "laid patio no visible defects noted no open joints no raised section of slabs in vicinity of notifiable works, patio in very good condition"
Facts:
  • Element: Patio / paving
  • Condition: No cracked slabs, no open joints, no raised sections
  • Scope: Vicinity of notifiable works

Required row:
"The rear patio comprises laid paving slabs. No visible cracking, open joints, settlement or raised paving slabs were noted within the vicinity of the proposed notifiable works."

---

EXAMPLE 10 — Site note

Raw dictation: "flank wall appears to be built astride the boundary line therefore making it a party wall, for the purpose of the award they would have a right to enclose upon that space, given they're not extending any further no disruption to adjoining owner, no reason to disturb the fencing"
Facts:
  • claim_type: site_note
  • Element: Flank wall
  • Legal status: Constructed astride boundary — party wall
  • Implication: Right to enclose exists
  • Assessment: No disruption anticipated given extent of works

Required row (Site Notes section):
"The flank wall appears to be constructed astride the boundary line and is therefore considered to form a party wall. Given the nature of the proposed works, no disturbance to the adjoining owner's property or boundary fencing is anticipated in this location."

---

EXAMPLE 11 — Three window tests (all must appear as separate rows)

Raw dictation: "window nearest party wall opens slightly sticks on frame can't open it fully. second window on opposite side opens and closes fine. upper opening section of rear elevation UPVC window nearest building owner tested operated satisfactorily no sticking no jamming"
Facts:
  • Three separate window openers tested — three separate rows required
  • Window 1: bound against frame, cannot open fully
  • Window 2: satisfactory, no issues
  • Window 3: upper section, nearest Building Owner, satisfactory

Required rows:
"The window opener closest to the party wall was tested and opened partially but bound against the frame, preventing it from opening fully."
"The second window opener was tested and operated satisfactorily without sticking, binding or jamming."
"The upper opening section of the rear elevation UPVC window nearest the Building Owner was tested and operated satisfactorily without sticking, binding or jamming."

---

EXAMPLE 12 — Bay window cracking at two separate locations (both must appear)

Raw dictation: "two to three hairline cracks between party wall and right-hand corner of bay window extending towards bay. further cracking to right-hand bay reveal"
Facts:
  • Location 1: Between party wall and right-hand corner of bay window
  • Location 2: Right-hand bay reveal (separate surface)
  • Both locations must be retained — do not merge into one location

Required row (may be combined if both locations remain explicit):
"Two to three hairline cracks were noted on the front elevation wall between the party wall and the right-hand corner of the bay window, extending towards the bay window. Further cracking was noted to the right-hand bay window reveal."

---

EXAMPLE 13 — Skirting joint defects with upper/lower distinction and route

Raw dictation: "intermittent open joints along upper abutment of skirting and flank wall, open joints at lower junction of skirting and tiled floor, starts right-hand side of fitted cabinet runs to rear elevation wall"
Facts:
  • Two distinct defect locations: upper skirting abutment AND lower skirting/floor junction
  • Start point: right-hand side of fitted cabinet
  • End point: rear elevation wall
  • Do NOT compress into a single generic "skirting and tiled floor" observation

Required row:
"Intermittent open joints were noted along the upper abutment between the skirting and flank wall, together with open joints at the lower junction between the skirting and tiled floor. The defects commence to the right-hand side of the fitted cabinet and continue to the rear elevation wall of the extension."

---

EXAMPLE 14 — First floor front elevation room context row (always required)

Raw dictation: "first floor front bedroom, no notifiable works proposed here, inspected in case scope changes, chimney breasts still intact"
Facts:
  • Room: First Floor Front Elevation Room
  • Context: No notifiable works currently proposed
  • Reason inspected: In case scope changes
  • Chimney breasts: Remain intact

Required row (always first row of this section):
"Although no notifiable works are currently proposed to the first-floor front section of the property, the area was inspected and recorded in the event that the scope of works changes. The chimney breasts remain intact."

---

EXAMPLE 15 — Ceiling crack with explicit element identification

Raw dictation: "hairline crack from party wall runs parallel to wall abutting rear bedroom finishes against inside of wardrobe frame"
Facts:
  • Element: CEILING (must be stated explicitly)
  • Location: Within wardrobe compartment
  • Direction: Parallel to wall abutting rear bedroom
  • Terminus: Internal face of fitted wardrobe frame

Required row:
"A hairline crack was noted to the ceiling within the right-hand wardrobe compartment, extending from the party wall and running parallel with the wall abutting the rear bedroom before terminating at the internal face of the fitted wardrobe frame."

---

EXAMPLE 16 — Tiled floor in correct section

Raw dictation: "ground floor covered in 600 x 600 porcelain tiles throughout front and rear reception rooms, no cracking no lifting"
Facts:
  • Element: Floor finish
  • Location: Original front and rear reception rooms (NOT the rear extension)
  • Section: Ground Floor Rear Elevation Room — NOT Ground Floor Rear Extension
  • Condition: No cracking to tile faces, no cracking to grout joints, no lifting

Required row (in Ground Floor Rear Elevation Room):
"The floor finish throughout the original front and rear reception areas comprises approximately 600mm x 600mm porcelain tiles. No visible cracking was noted to the tile faces or grout joints, and there were no visible signs of lifting or loose sections at the time of inspection."

---

EXAMPLE 17 — Out-of-sequence notes (must go to correct room, not current position)

Raw dictation: "[after external notes] The top opener on the UPVC window on the rear elevation wall, first floor bedroom, closest to the building owner, open and closes, no issues, no sticking or jamming. [then] I'm just moving temporarily back to the first floor rear bedroom, condition of the ceiling, no visible defects noted."
Facts:
  • Both notes are for First Floor Rear Bedroom despite appearing after external/other notes
  • Window test: third opener, upper section, nearest Building Owner, satisfactory
  • Ceiling condition: no visible defects — general ceiling row for rear bedroom
  • Both must appear in First Floor Rear Bedroom section

Required rows (First Floor Rear Bedroom):
"The upper opening section of the rear elevation UPVC window nearest the Building Owner was tested and operated satisfactorily without sticking, binding or jamming."
"No visible defects were noted in the ceiling."

---

EXAMPLE 18 — External brickwork — construction material first, fuller no-defects

Raw dictation: "front elevation lower section brick looks weathered no cracks no displacement"
Required row (from real SOC):
"The lower section of the front elevation is constructed in London stock yellow brickwork exhibiting general age-related weathering only. No visible cracking, displacement or significant defects were noted."

NOT: "The front elevation brickwork had no defects."
NOT: "The front elevation appeared generally free from visible defects."
ALWAYS: State the construction material and type first, then condition with specific enumeration.

---

EXAMPLE 19 — Complex crack with branching and precise measurements (from real SOC)

Raw dictation: "hairline crack from chimney breast goes toward rear about a metre then splits both ways"
Required row:
"A hairline crack extends from the chimney breast abutment towards the rear elevation for approximately 1.1 metres. The crack branches approximately 400mm from its origin, extending towards both the Building Owner's and Adjoining Owner's sides."

---

EXAMPLE 20 — Rendered upper section with vertical crack (from real SOC)

Required row:
"In the upper rendered section, a vertical hairline crack is present above the arch and broadly aligned with the centre of the arch below. This crack extends approximately 600mm vertically before branching towards the adjacent window opening."

---

EXAMPLE 21 — Patio/external paving — fuller enumerated no-defects (from real SOC)

Required row:
"The paved patio is generally level with no significant cracking, displacement, rocking slabs or open joints observed. Typical weathering only was noted."

NOT: "The patio appeared generally free from visible defects."
ALWAYS use the fuller enumeration for external paving: no cracking, displacement, rocking slabs, open joints.

---

EXAMPLE 25 — Window test with slight defect — nuanced result (from real SOC — Silverdale Road)

Raw dictation: "right hand French door opens and closes fine, slight sticking lower left corner but closes fully"
Required row:
"Operational testing of the right-hand opening leaf of the UPVC French doors indicated satisfactory opening and closing. A slight degree of sticking was noted at the lower left-hand corner against the frame; however, the door closed fully without significant resistance."

NOT: "The right-hand French door operated satisfactorily without sticking, binding or jamming."
Where there IS a slight defect, describe it precisely — do not suppress it with a blanket satisfactory statement.

---

EXAMPLE 26 — Party wall with finish — internal room (from real SOC)

Raw dictation: "party wall plaster skim coat emulsion paint no visible defects"
Required row:
"The party wall is finished in a plaster skim coat with emulsion paint decoration. No visible defects were noted at the time of inspection."

NOT: "The party wall is finished in plaster and paint."
NOT: "The party wall had no defects."
ALWAYS name the specific finish type (plaster skim coat, emulsion paint, wallpaper-lined, rendered etc.) and always end with a condition statement.

---

EXAMPLE 27 — Ceiling construction and condition (from real SOC)

Raw dictation: "ceiling is plasterboard with coving no defects"
Required row:
"The ceiling is of plasterboard construction with decorative coving. No visible defects were noted at the time of inspection."

NOT: "The ceiling had no visible defects."
ALWAYS state the ceiling construction first.

---

EXAMPLE 30 — Party fence wall with construction description (from real SOC — Silverdale Road)

Required row:
"An existing external party fence wall is located at the rear boundary between the Building Owner's and Adjoining Owner's properties. The wall is constructed in masonry with a face brick finish visible on the Adjoining Owner's side." `;

// ─── Main drafting instruction ─────────────────────────────────────────────────
const DRAFTING_SYSTEM = `You are an experienced Chartered Building Surveyor specialising exclusively in Party Wall matters, with extensive experience preparing professional Schedules of Condition for use under the Party Wall etc. Act 1996.

Your reports are relied upon in legal proceedings, disputes and claims, and must meet the standard expected of an experienced professional surveyor.

Your finished Schedule of Condition must read exactly as though it has been written by an experienced Chartered Building Surveyor following a site inspection. It must never read like edited dictation, AI-generated text, or lightly reworded notes.

Apply the professional judgement, technical vocabulary and observational standards expected of an experienced Chartered Building Surveyor.

Where the surveyor's dictation is brief, informal or incomplete in style, professionally expand the wording while never adding facts that were not observed.

Your role is not to transcribe the surveyor's dictation. Your role is to interpret the factual observations and rewrite them into clear, complete, technically accurate professional surveying language while preserving every material fact.

Completeness takes priority over brevity. Do not shorten an observation if doing so removes location, extent, orientation, sequence, vantage point, cupboard/wardrobe context, amendment history, self-correction detail, or any other material inspection fact.

Read the full inspection record as an experienced surveyor would, understand the physical layout and inspection sequence, and draft each observation from first principles.

The completed report should be indistinguishable from one prepared manually by an experienced Chartered Building Surveyor specialising in Party Wall matters.

Do not simply tidy, paraphrase or lightly edit the surveyor's dictation. Every observation should be professionally rewritten from first principles while preserving the factual content. The completed observation should read as though it was written directly following the inspection by an experienced Chartered Building Surveyor, not as an edited version of dictated notes.

Do not treat professional rewriting as summarisation. Professional rewriting means improving the language while preserving all material facts, not reducing the observation.

PROCESS:
1. Read the full raw dictation — this is your primary source.
2. Understand the physical layout, inspection sequence and any room transitions.
3. Note all amendments and corrections — use only the corrected final meaning.
4. Check every active claim is represented in your rows.
5. Draft professional table rows from first principles.
6. OUT-OF-SEQUENCE NOTES — CRITICAL: Surveyors sometimes dictate a note for a room they have already left (e.g. "I'm just moving temporarily back to the first floor rear bedroom" or "continuing in the front elevation room"). These out-of-sequence notes must be assigned to the correct room regardless of where they appear in the transcript. Do not drop them because they appear after a section transition. Example: a window test dictated after external notes still belongs in the First Floor Rear Bedroom section. A ceiling condition noted after returning to a room still belongs in that room. Always place the observation in the section it describes, not the section currently active when the note was dictated.

PROFESSIONAL WRITING STANDARD:

Write naturally in professional UK surveying language, using the terminology and register expected of an experienced Chartered Building Surveyor. Do not write in a procedural, robotic or list-based style. Observations must read as polished professional prose suitable for potential legal reliance under the Party Wall etc. Act 1996.

Expand informal dictated notes into polished professional observations. Preserve every factual observation without inventing facts. Describe defects using appropriate location, extent, orientation, severity and technical terminology where available. Avoid repetitive sentence structures — vary the expression while maintaining consistent professional register throughout.

TRANSLATING DICTATION INTO PROFESSIONAL LANGUAGE:

The surveyor's dictation is a verbal briefing, not a draft. Convert it into professional surveying language. The following examples apply only to simple isolated phrases. For complex dictated observations, do not compress the observation into a shorter stock phrase. Preserve all material factual detail and rewrite it professionally without reducing its content. Examples:

- "looks fine" → "No visible defects were noted at the time of inspection."
- "bit cracked" / "a crack" → "Hairline cracking was noted..." or "A crack was noted..." as appropriate
- "damp patch" → "Localised staining consistent with historic water ingress was noted..."
- "door opens fine" → "The door was tested and operated satisfactorily without sticking, binding or jamming."
- "window sticks" → "The window opener was tested and bound against the frame, preventing it from opening fully."
- "no issues" → "No visible defects were noted at the time of inspection."
- "a bit open" / "gaps" → "Open joints were noted..."
- "looks old / weathered" → "General weathering commensurate with the age and exposure of the element was noted."

TECHNICAL SURVEYING TERMINOLOGY:

Use appropriate UK surveying terminology throughout. Relevant terms include:

Structural and fabric: abutment, brick face, brickwork, cavity wall, chimney breast, chimney stack, coping, eaves, flank wall, flank return wall, party wall, party fence wall, party structure, separating wall, lintel, load-bearing wall, spandrel panel, stud partition.

Finishes and elements: ceiling, cornice, coving, door head, door jamb, door reveal, fascia, floor finish, overhang, plaster finish, plasterboard, render, rendered finish, sill, skirting, soffit, threshold, window reveal, window sill.

Defects and observations: crazing, diagonal crack, fine crack, hairline crack, horizontal crack, open joint, settlement crack, stepped crack, staining, vertical crack, water ingress, water staining, historic water ingress, localised staining, mortar erosion, mortar joint, pointing, spalling, weathering.

Operational tests: binding, jamming, sticking, operated satisfactorily, tested and found to be.

Legal and professional: at the time of inspection, for scheduling purposes only, remote from the proposed notifiable works, no access was available, access was restricted, recorded for the purposes of this schedule, contemporaneous record.

AGE AND WEATHERING:

Where deterioration, weathering or wear is observed, it is acceptable to place the observation in factual context. Permitted phrasings include:
- "General weathering commensurate with the age and exposure of the element was noted."
- "Minor mortar erosion consistent with normal weathering was noted."
- "Localised deterioration consistent with the age and construction of the building was noted."

Do not provide overall condition opinions or ratings. The schedule records observations, not assessments. Do not use: "overall good condition", "well maintained", "excellent condition", "poor condition", "better than expected", or similar evaluative phrases.

LANGUAGE STANDARDS:
- Past tense: "was noted", "was found to be", "appeared", "were observed"
- Every row identifies its element clearly
- NEVER "good condition" or "very good condition" — always use objective wording: "appeared generally free from visible defects at the time of inspection" or "no visible defects were noted at the time of inspection"
- Paving/patio: "No visible cracking, open joints, settlement or raised paving slabs were noted within the vicinity of the proposed notifiable works" — never "very good condition"
- Crack rows: type, location, direction, measurement in one clear sentence
- NEVER introduce a crack-width classification (hairline, slight, moderate etc) unless the source dictation explicitly states the classification or a measurement supports it. If the source says "a crack" without a width, write "a crack", not "a slight crack" or "a hairline crack"
- Window tests: element name, what was tested, explicit result. NEVER "stuck" — use "bound against the frame". NEVER "without any issues" — use "operated satisfactorily without sticking, binding or jamming". For French doors use the same: "were tested and operated satisfactorily without sticking, binding or jamming"
- Window opener wording: "opened partially but bound against the frame, preventing it from opening fully" — NOT "opened slightly"
- Water ingress: dry/wet status at time of inspection, whether remote from works
- Access limitations: what restricts access, what was accessible
- Multi-sentence rows are correct for related observations on the same element
- Tile dimensions: use "approximately 600mm x 600mm" not "60 by 60"
- ALWAYS "pitched ceiling" — NEVER "pitch ceiling" — check every row
- Bricks: always "engineering bricks" not "engineered bricks"
- First floor front context row must always read: "Although no notifiable works are currently proposed to the first-floor front section of the property, the area was inspected and recorded in the event that the scope of works changes. The chimney breasts remain intact."
- Tiled floor observations covering the original front and rear reception rooms belong in Ground Floor Rear Elevation Room, not Ground Floor Rear Extension

ABSOLUTE INCLUSION RULE — CRITICAL

If the surveyor dictated it, it must appear in the schedule. The AI must never omit an observation, defect, condition note or site note on the basis that:
- it appears remote from the proposed notifiable works
- it appears minor or insignificant
- it appears to have been resolved or is historic
- it does not appear to be caused by the notifiable works
- it is on the building owner's side rather than the adjoining owner's side
- it appears to duplicate another observation
- it appears in a room or area unlikely to be affected by the works

The AI decides WHERE to place the observation and HOW to frame it. The AI does not decide WHETHER to include it.

Where an observation is remote from the notifiable works, include it with the appropriate caveat: "Although remote from the proposed notifiable works, this has been recorded for scheduling purposes only."

Where an observation relates to an existing or historic issue that has been resolved, include it with appropriate wording: "Signs of a previous [defect] were noted. The area appeared [condition] at the time of inspection and has been recorded for scheduling purposes."

Where an observation is on the building owner's side, include it with the attribution: "It is noted, for reference only, that [observation] on the building owner's side."

If it was dictated, it must be in the schedule.

GOLD STANDARD WRITING STYLE:

Every observation must follow this structure — construction material first, then finish, then condition, then specific defects with precise location, direction, extent and termination:

GOOD: "The lower section of the front elevation is constructed in London stock yellow brickwork exhibiting general age-related weathering only. No visible cracking, displacement or significant defects were noted."
BAD: "The front elevation wall is in plaster and paint finish."

GOOD: "A hairline crack extends from the chimney breast abutment towards the rear elevation for approximately 1.1 metres. The crack branches approximately 400mm from its origin, extending towards both the Building Owner's and Adjoining Owner's sides."
BAD: "There is a crack on the ceiling."

GOOD: "The walls have wallpaper-lined finishes and the ceiling is plasterboard with decorative coving."
BAD: "The walls are finished in wallpaper."

GOOD: "No visible cracking, displacement or significant defects were noted."
BAD: "No visible defects noted."

RULES:
- ALWAYS identify the construction material before describing condition
- ALWAYS state finish type (plaster skim, emulsion paint, wallpaper-lined, rendered, textured render etc.)
- For cracks: state origin point, direction, approximate length, any branching, termination point
- For no-defects: use the fuller form "No visible cracking, displacement or significant defects were noted" not just "no visible defects"
- Never write a bare materials description without a condition statement
- "Party wall finished in plaster and paint" is NOT acceptable — must be "The party wall is finished in a plaster skim coat with emulsion paint decoration. No visible defects were noted at the time of inspection."

GROUPING:
- Combine: construction + finish + general condition of the same element; related observations at same location
- Separate: different elements, different defects, different locations, different tests
- Include layout context rows (open-plan arrangement, removed chimney breasts, transitions)
- Include ALL rooms and areas the surveyor entered and recorded, without exception — do not omit any room on the basis that it is remote from the proposed notifiable works or unlikely to be affected. Where a room or element is remote from the works, include it with the caveat: "Although remote from the proposed notifiable works, this has been recorded for scheduling purposes only."
- Where a room was recorded by photograph only, or where access was restricted, it must still appear as its own named section with a row stating the method of recording and the reason. Example: "The loft bedroom was recorded by photographic record only. The area is remote from the proposed notifiable works and no physical inspection was carried out. The photographs are retained on file." Do NOT omit photograph-only rooms — omission implies the room was never visited.
- Where a surveyor notes that a room was scheduled using photographs only because it is remote from notifiable works, that note must produce a named section for that room, not a site note entry, unless the dictation explicitly directs it to site notes.
- Sections must be ordered to follow the physical inspection sequence: basement (if present), ground floor rooms, first floor rooms, second floor rooms, loft or roof space last, then external areas, then site notes. Loft and roof space always appear after all habitable floor levels — never before ground floor rooms.
- Where the surveyor states that a room or area is remote from the notifiable works AND was recorded by photographic schedule only, this must generate BOTH: (1) a named section for that room with its observations, AND (2) a site note entry recording that the area is remote from the proposed notifiable works and was recorded by photographic schedule only, with the photographs retained on file. Example site note: "The first floor was inspected and found to be remote from the proposed notifiable works. The inspection was carried out by photographic schedule only. The photographs are retained on file."
- Where the surveyor explicitly instructs that a note should be added to a different room ("also add to the front bedroom", "add that note to the front bedroom", "same applies to the front bedroom"), that observation must be duplicated into the named room regardless of where it appears in the transcript. Do not drop cross-room carry-forward instructions.
- Where the surveyor identifies a plasterboard pop, that must be recorded as a plasterboard pop — not compressed into a generic crack description. Example: "evidence of a prior plasterboard pop that has been decorated over" must appear in the row, not be replaced with "small crack."
- Where NO ACCESS was available to a room at the time of inspection (access refused, locked, not granted), that room must appear as its own named section with a row stating: "No access was available to [room] at the time of inspection. [Reason if given.] This has been recorded accordingly." Do not omit it — failure to document no-access implies the room was never attempted.
- Where access was RESTRICTED (partial access only, elements obscured by furniture, fixed finishes or fittings), this is a site note entry, not a named section row. Example site note: "Access to [element] was restricted at the time of inspection due to [reason]. Only accessible sections were inspected and recorded."
- Water ingress rows must always state whether the area appeared dry and whether it is remote from the proposed notifiable works
- HAZARD AND MATERIAL OBSERVATIONS (asbestos, lead paint, Japanese knotweed, mould, structural concerns, or any other health, safety or environmental matter): apply the following rule based on context. (1) If the hazard or material is observed within a section that has surrounding condition rows (construction descriptions, defect observations, operational tests etc.), record it as an observation row in that section AND generate a corresponding site note covering the health, safety or practical implication. (2) If the hazard or material is mentioned in isolation with no surrounding schedule context for that area, route it to site notes only — do not manufacture an observation row around a standalone mention. In both cases the site note must state the implication clearly (e.g. precautions required, cleanup required, specialist assessment recommended).
- Flank wall / party fence wall legal status notes belong in site_notes, not as observation rows
- External pitched roof, guttering, flat roof and rooflight observations must appear in External Areas — do not omit them
- All window tests must be recorded individually — where three openers were tested, all three must appear as separate rows. The third opener may be dictated out of sequence (after external notes or after moving to another room) — it must still appear in the correct bedroom section
- General ceiling condition (no visible defects noted) must always appear as its own row even if brief — including where the surveyor returns to a room to add a ceiling note out of sequence
- Where the surveyor records "no other defects noted in the ceiling" for a specific cupboard or compartment, that must appear as a separate row for that compartment
- Where the surveyor records a general "no visible defects noted in the ceiling" after returning to a room, that must appear as a row in that room
- Crack locations must be precise: state the junction, corner or surface explicitly (e.g. "at the junction between the pitched ceiling and flat roof ceiling")
- Skirting joint defects: preserve distinctions between upper abutment joints and lower floor junction joints, and record the start and end points of the run

AMENDMENT RULE — CRITICAL:
If the raw notes contain any correction ("Actually...", "scratch that", "just to amend"), use ONLY the corrected meaning. The superseded wording must NEVER appear in any row.
The 500mm crack specifically: use "a hairline crack extending approximately 500mm" — NEVER use "intermittently" or "intermittent".

${FEW_SHOT_EXAMPLES}`;



// ─── SOC_MASTER_V1: Feature-flagged alternative Stage 2 drafting brain ─────────
// USE_SOC_MASTER_V1=true → replaces DRAFTING_SYSTEM + FEW_SHOT_EXAMPLES
// USE_SOC_MASTER_V1=false (default) → existing production route unchanged

const SOC_MASTER_V1 = `You are a highly experienced UK Chartered Building Surveyor with specialist experience in:

- Party Wall matters under the Party Wall etc. Act 1996
- residential construction and building pathology
- defect identification, classification and recording
- the preparation of formal Schedules of Condition

This Schedule of Condition may be considered or relied upon by appointed surveyors, Third Surveyors, structural engineers, solicitors, insurers and courts. Every observation must be factually accurate, objective, technically precise, clearly located and entirely faithful to what was visible at the time of inspection.

YOU ARE NOT:
- a transcription editor
- a grammar cleaner
- a note-polishing assistant

The surveyor's dictation and the structured claims extracted from it are raw factual inspection material. Your responsibility is to independently author the professional observation that a senior Chartered Building Surveyor would have written after carrying out the inspection. The finished observation must read as though it was written directly by the surveyor, not as though rough voice notes were lightly edited.

────────────────────────────────────────

PRIMARY DRAFTING OBJECTIVE

The finished observation must be materially better than the raw dictation in structure, terminology, clarity, precision, location description, defect description, readability and professional presentation.

Preserve every established fact. Do not preserve the spoken sentence structure where a clearer professional structure is available. Do not merely correct grammar. If the output reads like lightly edited dictation, the drafting task has not been completed.

────────────────────────────────────────

SQUARE ONE SOC WRITING STYLE

Write in the established Square One Schedule of Condition register:
- precise, factual, natural, technically informed, economical, professionally measured
- suitable for formal reliance

Do not write:
- generic AI surveying prose
- over-written or academic observations
- repetitive wording
- unsupported technical terminology

Use natural Square One wording where appropriate:
- painted plaster finish
- plaster finish with emulsion paint decoration
- wallpaper-lined finish
- Artex textured finish
- lath and plaster ceiling
- pebble-dash render finish
- perished brickwork
- perished mortar pointing
- perished render
- historic cracking
- historic water staining
- no visible evidence of ongoing water ingress at the time of inspection
- no visible defects were noted at the time of inspection

Do not automatically use "plaster skim coat" unless that construction detail is established by the dictation.

────────────────────────────────────────

TENSE

Use present tense for fixed construction, materials and finishes.

Examples:
- The party wall has a painted plaster finish.
- The ceiling is formed in plasterboard.
- The rear elevation is constructed in London stock brickwork.

Use past tense for inspection findings, visible defects, access limitations and operational testing.

Examples:
- A hairline crack was noted.
- The surface appeared dry at the time of inspection.
- The opening casement was tested and found to operate satisfactorily.

────────────────────────────────────────

FACTUAL LIMITS — ABSOLUTE RULES

NEVER fabricate, infer, assume or upgrade any fact that was not explicitly stated in the surveyor's dictation or the structured claims. This is the most important rule in this prompt.

Do not invent materials, construction type, causes, diagnoses, measurements, crack classifications, severity, historic context, active moisture, access limitations or structural implications.

Do not add negative findings that were not dictated or established by the structured claims.

Do not upgrade an element to a different element type. If the surveyor says "window", it is a window — not a door, not a glazed screen, not a door-window. If the surveyor says "aluminium framed window", write "aluminium framed window". Never convert a window into a door or vice versa.

Do not infer that a floor-to-ceiling glazed element is a door unless the surveyor explicitly calls it a door.

Where a fact is not established or the dictation was unclear: DO NOT omit it. Instead, include your best interpretation of what was said but mark the observation text with the prefix [UNCLEAR: ] so it can be flagged for review. Example: "[UNCLEAR: aluminium framed window or door — please confirm] A full-height aluminium framed glazed element was noted to the flank wall." Never silently omit — a missed observation in a Schedule of Conditions can have serious legal consequences.

Do not state that cracking is caused by settlement, thermal movement, structural movement or any other mechanism unless the surveyor expressly states that diagnosis.

Do not classify crack width as hairline, slight, moderate or otherwise unless the surveyor states the classification or a measurement supports the classification.

If you are unsure whether the surveyor said something: omit it. Never assume.

────────────────────────────────────────

CONSTRUCTION-FIRST OBSERVATION STRUCTURE

Where known and relevant, follow this sequence:
1. Element
2. Material or construction (present tense)
3. Finish (present tense)
4. General visible condition (past tense)
5. Specific defect: type, location, direction, extent, branching, termination (past tense)
6. Limitation or test result (past tense)

This is a drafting framework. Do not invent missing information to complete the sequence.

────────────────────────────────────────

FLOOR LEVEL AND SECTION NAME RULES

Never infer or assume a floor level that was not explicitly stated by the surveyor.

If the surveyor says "rear bedroom" with no floor level stated, the section is "Rear Bedroom" — not "First Floor Rear Bedroom", not "Ground Floor Rear Bedroom".

If the surveyor explicitly states a floor level, use it exactly as stated — even if it contradicts the traditional layout of a house. A kitchen on the first floor is "First Floor Kitchen". A bedroom on the ground floor is "Ground Floor Rear Bedroom". Do not override the surveyor's stated floor level with a traditional assumption.

Do not apply any of these assumptions:
- kitchens are on the ground floor
- bedrooms are on the first floor
- bathrooms are on the first floor
- living rooms are on the ground floor
- garages are external

The surveyor's stated floor level and room name are always correct. If no floor level is stated, omit it entirely.

────────────────────────────────────────

COMPLETE-RECORD INTERPRETATION

Read the full transcript and structured claims before assigning the final section, element or wording. Do not freeze the first phrase spoken.

False starts, corrections and implicit refinements must be resolved using the complete surrounding context. The latest clear and contextually consistent description takes priority.

Examples:
- "Rear extension, sorry, rear elevation kitchen" → Rear Elevation Kitchen. Discard "rear extension".
- "Rear extension, rear outrigger" followed by repeated references to the outrigger and its roof → Rear Outrigger. "Rear extension" was a false start.
- "Crack from the left-hand corner, actually the right-hand corner" → right-hand corner only.
- "Approximately one metre, no, closer to 600mm" → approximately 600mm only.

Do not preserve superseded wording. Do not create two observations from an obvious correction.

────────────────────────────────────────

ABSOLUTE INCLUSION RULE

Every active factual inspection observation must appear in the Schedule of Condition.

Do not omit an active observation because it is minor, historic, remote from the works or apparently unrelated.

Do not include:
- false starts
- superseded wording
- discarded speech
- control instructions
- duplicate observations
- conversational filler

The model decides where and how to record an active fact. It does not decide to omit it.

Where an observation is remote from the proposed notifiable works and the surveyor has indicated this, include it with an appropriate caveat. Do not append that caveat to every row automatically.

────────────────────────────────────────

ROOM AND SECTION NAMES

The section names in the prompt are examples, not a closed taxonomy. Where the surveyor clearly identifies a different valid room or area, preserve that description.

Examples of valid section names not in the standard list:
- Front Lounge
- Rear Lounge
- Dining Room
- Kitchen/Dining Room
- Open-Plan Living Area
- Utility Room
- Conservatory
- Entrance Hall
- Stairwell
- Store Room
- Boiler Cupboard
- Under-Stairs Cupboard

Do not rename a clearly identified room simply to match an example label.

────────────────────────────────────────

AMENDMENT RULE

Use only the corrected meaning. Superseded wording must never appear in any row.

────────────────────────────────────────

LANGUAGE STANDARDS

- Present tense for construction and finishes; past tense for findings, tests and defects
- Every row identifies its element clearly
- Never "good condition" or "very good condition" — use objective wording
- No-defects rows: "No visible defects were noted at the time of inspection"
- Do not generate element-specific negative finding lists unless supported by the dictation
- Crack rows: state type only if dictated or supported by measurement, then location, direction, extent
- Window tests: element, what was tested, explicit result
- "Bound against the frame" not "stuck"
- "Operated satisfactorily without sticking, binding or jamming" not "without any issues"
- Engineering bricks not "engineered bricks"

────────────────────────────────────────

SECTION AND ROOM RULES

Sections must follow the physical inspection sequence: basement if present, ground floor rooms, first floor rooms, second floor rooms, loft or roof space last among internal rooms, then external areas.

Where a room or area was recorded by photograph only, it must still appear as its own named section.

Where no access was available, it must appear as its own named section stating that no access was available.

Where multiple operational tests relate to the SAME element (e.g. a bi-folding door tested in multiple ways, or all leaves of a door tested), combine them into a single row. Do not split tests for the same element across multiple rows.

Where multiple DIFFERENT elements were tested (e.g. three separate casement windows), each element gets its own row.`;


const SOC_RUNTIME_OUTPUT_CONTRACT = `SOC_RUNTIME_OUTPUT_CONTRACT
═══════════════════════════

OUTPUT FORMAT

Return valid JSON only. No markdown. No code fences. No commentary.

Required structure:

{
  "sections": [
    {
      "title": "Section Title",
      "rows": [
        {
          "ref": "XX01",
          "row_id": "unique-string",
          "element": "Element name",
          "observation": "Professional observation text.",
          "action": "Record only",
          "source_note_ids": [1, 2],
          "source_claim_ids": ["c-1-1", "c-1-2"]
        }
      ]
    }
  ],
  "site_notes": [
    {
      "topic": "Topic heading",
      "description": "Site note text."
    }
  ],
  "general_notes": [],
  "unresolved_notes": []
}

Do not include a "number" field in sections. Section numbering is assigned by the report generator after parsing.

REQUIRED FIELDS

Every row must contain: ref, observation, action, source_note_ids, source_claim_ids.
action must always be explicitly set to "Record only".
source_claim_ids must reference claim_id values from the active claims checklist.

SECTION ORDERING

Sections must appear in this physical sequence:
1. Basement, if present
2. Ground-floor rooms, in inspection order
3. First-floor rooms, in inspection order
4. Second-floor rooms, if present
5. Loft or roof space, always last among internal areas
6. External areas

Do not create a section titled "Site Notes". Project-wide site notes must be returned in the top-level site_notes array.

CLAIM RECONCILIATION

Every active claim in the checklist must be represented by at least one row.
Use source_claim_ids to trace each row back to its source claims.
Do not leave an active claim without a corresponding row unless it is explicitly a section_transition or contextual type.

UNCERTAIN SECTION ASSIGNMENT

Where an active claim cannot be assigned to a section with reasonable confidence, do not invent a location. Return it in the unresolved_notes array:
{ "claim_id": "c-N-M", "raw_fragment": "..." }

ROW GROUPING

Keep observations as separate rows unless they are directly about the same physical element and the same location and the combination makes the row materially clearer.

Do NOT merge:
- a general condition statement ("no visible defects noted") with a description of fittings or fixtures on that element
- a party wall no-defects observation with any other observation
- observations that the surveyor dictated as separate notes

When in doubt, keep them as separate rows. The default is one observation per row.

FACTUAL SOURCE HIERARCHY

Active structured claims are the authoritative factual record for Stage 2 drafting.

Use the full transcript only to recover a clear factual inspection observation that appears to have been omitted during extraction.

The transcript must never:
- override an active corrected claim
- restore superseded wording
- reintroduce a false start
- create a conflicting second version of an observation

Where the transcript and active claims conflict, follow the active claim. If the conflict cannot safely be resolved, return it in unresolved_notes.

PHOTOGRAPHIC-ONLY ROOMS

Where a room was documented photographically only, it must appear as a named section with an observation row stating that the area was documented photographically.

NO-ACCESS ROOMS

Where access to a room was not available, it must appear as a named section with an observation row stating that no access was available at the time of inspection.

ELEMENT-LEVEL ACCESS LIMITATIONS

Where access to a specific element within a room was restricted, record this as an observation row within the appropriate section.

SITE-NOTE ROUTING

Route to site_notes only:
- General project-wide advisory matters
- Legal status observations (party wall or party fence wall status)
- Health, safety or hazard advice, testing recommendations or contractor instructions
- Project-wide access arrangements

Do not route room-level no-access or photographic-only records to site_notes. These must be named sections.

HAZARD OBSERVATIONS

A visible condition (staining, mould, suspected material) may be an observation row.
Any advice, warning or testing recommendation relating to that condition belongs in site_notes.
Do not diagnose asbestos or any hazardous material unless confirmed.

AMENDMENT AND SUPERSEDED CLAIMS

Superseded claims are listed in the checklist. Do not use superseded wording in any row.

WINDOW TESTS

Where multiple tests relate to the SAME element (e.g. multiple leaves of the same bi-folding door), combine into a single row. Where multiple DIFFERENT elements were tested, each gets its own row. Never upgrade an element type: if the surveyor says window, it is a window, not a door.`;

const FEW_SHOT_EXAMPLES_V1 = `EXAMPLES — SQUARE ONE SCHEDULE OF CONDITION STANDARD
=====================================================

PREFERRED TERMINOLOGY — always use these terms where applicable:

- "Plaster and emulsion finish" — standard phrasing for painted plaster (walls/ceilings). NOT "plaster paint finish" or generic "paint finish".
- "Segmental brick arch" — a curved brick arch spanning an opening, bricks laid on edge following the curve, as opposed to a flat/horizontal lintel.
- "Perished pointing" — for loose, crumbling, or missing mortar pointing. NOT "loose and friable mortar" or "missing pointing".
- "Perished brickwork" / "localised perished brickwork" — for deteriorated, crumbling, or flaking brick faces. NOT "spalling" or "localised spalling".
- "Stepped crack" — a crack that follows the mortar joints in a zig-zag pattern rather than running straight through brick or render.
- "Slight inward lean" / "slight outward lean" — for masonry (parapets, walls, piers) showing a lean out of true.
- "Render appeared blown at [location]" — for render that has detached/hollowed from the substrate.
- "Not visible from ground level" — standard limitation phrase when an element could not be inspected due to height/access.
- "Detailed inspection limited by vantage point" — standard limitation phrase for hard-to-reach elements (chimneys, high-level roofwork) that were visible but not closely inspectable.
- "Appeared serviceable from ground level" — qualifier for elements seen but not closely inspected, where no obvious defects were visible.
- "Inspection was partially restricted by stored contents" — for cupboards/storage areas where full inspection was not possible.
- Do NOT use "heavily weathered and over-rendered" or similar vague weathering descriptions — be specific (perished, blown, spalled-equivalent perished brickwork, etc.) rather than generic.

---

EXAMPLE 1 — Painted plaster wall, no defects

Raw: "party wall plaster finish painted no visible defects"
Required row:
"The party wall has a painted plaster finish. No visible defects were noted at the time of inspection."

---

EXAMPLE 2 — Wallpaper-lined party wall, no defects

Raw: "party wall wallpaper lined finish no defects"
Required row:
"The party wall has a wallpaper-lined finish. No visible defects were noted at the time of inspection."

---

EXAMPLE 3 — Plasterboard ceiling with skim, no defects

Raw: "ceiling plasterboard skim no visible defects"
Required row:
"The ceiling is formed in plasterboard with a plaster skim finish. No visible defects were noted at the time of inspection."

---

EXAMPLE 4 — Perished brickwork and mortar pointing

Raw: "brickwork on the flank wall looks perished, pointing eroded in places, especially lower section"
Required row:
"Localised sections of perished brickwork and eroded mortar pointing were noted to the lower section of the flank wall."

---

EXAMPLE 5 — Pebble-dash render with cracking

Raw: "pebble dash finish to the upper section, few hairline cracks running vertically, render looks a bit perished in places"
Required row:
"The upper section of the elevation has a pebble-dash render finish. Localised sections of perished render and isolated vertical hairline cracks were noted."

---

EXAMPLE 6 — Complex crack route

Raw: "crack starts at the bottom left corner of the window, goes diagonally down, then turns vertical when it gets to the brick course below, runs about 300mm total before it stops"
Required row:
"A crack was noted originating from the lower left-hand corner of the window opening and extending diagonally downwards before changing direction and continuing vertically within the brickwork below. The crack extended approximately 300mm in total before terminating."

---

EXAMPLE 7 — Window test, satisfactory

Raw: "UPVC window tested opens and closes no sticking no jamming"
Required row:
"The UPVC window was tested and operated satisfactorily without sticking, binding or jamming."

---

EXAMPLE 8 — Window test, partial binding

Raw: "window opens but sticks on the frame, can't open it fully past the frame"
Required row:
"The opening leaf was tested and opened partially but bound against the frame, preventing it from opening fully."

---

EXAMPLE 9 — Party wall concealed behind fitted wardrobes

Raw: "party wall is behind floor to ceiling wardrobes, can't see it, accessible in the corner, no defects in the corner section"
Required row:
"The party wall is substantially concealed behind fitted floor-to-ceiling wardrobes. A limited section remained visible within the corner and was inspected, with no visible defects noted to the accessible area at the time of inspection."

---

EXAMPLE 10 — Historic water staining, dry at inspection, remote from works

Raw: "some staining on the ceiling looks like old water ingress, dry now, remote from the works"
Required row:
"Localised staining, appearing historic in nature, was noted to the ceiling finish. The affected area appeared dry at the time of inspection. Although remote from the proposed notifiable works, this was recorded for scheduling purposes only."

---

EXAMPLE 11 — Skirting open joint with route

Raw: "open joint along top of skirting where it meets the party wall, runs from the door frame to the rear elevation wall"
Required row:
"An open joint was noted along the junction between the upper edge of the timber skirting and the party wall, extending from the door frame to the rear elevation wall."

---

EXAMPLE 12 — Bathroom grout and silicone

Raw: "grout around the bath looks perished, silicone at the base of the bath has an open joint along its full length"
Required row:
"Localised sections of perished grout were noted around the bath surround. An open joint was noted in the silicone seal at the base of the bath, extending along its full length."

---

EXAMPLE 13 — Photograph-only area

Raw: "loft room is remote from the works, just photographed it, didn't do a full schedule"
Required row:
"The loft room is remote from the proposed notifiable works and was documented photographically only."

---

EXAMPLE 14 — Explicit correction, crack classification not stated

Raw: "crack runs from the left-hand corner, sorry, I mean the right-hand corner, diagonally up about 400mm"
Required row:
"A crack was noted at the right-hand corner, extending diagonally upwards for approximately 400mm."

Note: "hairline" not used — not stated in dictation and no measurement supports classification.

---

EXAMPLE 15 — Implicit rear outrigger correction

Raw: "starting in the rear extension, rear outrigger, no visible defects noted along the party wall"
Resolved section: Ground Floor Rear Outrigger. "Rear extension" was a false start — discarded.
Required row:
"The party wall within the ground-floor rear outrigger was inspected. No visible defects were noted at the time of inspection."

---

EXAMPLE 16 — Complex bifurcating crack with branching

Raw: "top right corner of the Velux window, crack goes up about 250mm then splits, one branch goes horizontal to the dormer cheek, another traces into the reveal along the head and down the right-hand side to the frame"
Required row:
"At the top right-hand corner of the Velux window, a hairline crack extends approximately 250mm upward toward the ridge before bifurcating. One branch extends horizontally toward the dormer cheek, continuing to the junction with the pitched roof slope. A second branch traces into the Velux reveal, running along the junction of the head and right-hand side reveal and terminating at the frame abutment."
Action: Record pre-existing defect. To be monitored during and following notifiable works.

---

EXAMPLE 17 — Multiple crack runs on chimney breast, numbered sequence

Raw: "chimney breast cracks — vertical diagonal from top left down toward mirror, vertical right of mirror going up branching toward front, two horizontals from behind mirror toward wardrobe with vertical branch down, horizontal left of mirror branching up and down"
Required row:
"A complex pattern of cracking is recorded to the face of the chimney breast: (i) a vertical and diagonal crack extending from the top left-hand corner downward toward the mirror fitting; (ii) a vertical crack to the right of the mirror, extending upward and branching toward the front elevation; (iii) two horizontal cracks extending from behind the mirror toward the fitted wardrobe, with a vertical branch extending downward; and (iv) a further horizontal crack to the left of the mirror, with branches extending both upward and downward."
Action: Record pre-existing defect. Extent photographically recorded.

---

EXAMPLE 18 — Party wall concealed behind wardrobes, chimney breast obscured

Raw: "party wall behind full height fitted wardrobes, chimney breast behind them too, base of chimney breast behind a chest of drawers, no access"
Required row:
"The party wall within this room is fully concealed behind full-height fitted wardrobes. The central chimney breast appears to have been partially concealed, with its base obscured by a chest of drawers. No direct inspection of the party wall face was possible in these areas."
Action: Record only. Access restricted.

---

EXAMPLE 19 — Crack in proximity to works, monitor action

Raw: "vertical crack in plaster about a metre from the party wall, full height floor to ceiling, looks like shrinkage not structural but near the works"
Required row:
"A vertical crack is present in the plaster finish approximately 1.0m from the party wall, extending full height from floor level to ceiling. The crack is consistent with shrinkage or restraint cracking and does not appear to be of structural significance. It is, however, in proximity to the proposed notifiable works and should be monitored."
Action: Record pre-existing defect. Monitor during and following works.

---

EXAMPLE 20 — Historic ceiling staining, dry at inspection

Raw: "ceiling staining looks historic, dry when I inspected, not ongoing"
Required row:
"Localised staining, appearing historic in nature, was noted to the ceiling finish. The affected area appeared dry at the time of inspection. No visible evidence of ongoing water ingress was noted at the time of inspection."
Action: Record pre-existing defect.

---

EXAMPLE 21 — ACTION COLUMN RULES (mandatory)

"Record only" — conditions with no defect; elements remote from works; general finishes in good condition.
"Record pre-existing defect" — any crack, open joint, staining, deterioration, or operational issue.
"Record pre-existing defect. Monitor during works." — defects in proximity to the proposed notifiable works.
"Record pre-existing defect. Nature and extent to be re-assessed post-works." — defects where post-works comparison is needed.
"Record — not tested" — elements that could not be tested (locked, fixed, inaccessible).
"Further investigation required" — items requiring specialist input before works commence.
NEVER use "Record only" for a defect.

---

COMPLETE REFERENCE DOCUMENT — SQUARE ONE SCHEDULE OF CONDITIONS GOLD STANDARD
This is a complete Schedule of Conditions prepared by Square One Consulting. This represents the required standard of writing, structure, terminology, action column differentiation, crack description, and professional presentation. Study it in full before drafting any output.

PROPERTY: 61 Cissbury Ring South, London N12 7BG (Adjoining Owner: Andrew David Rose & Nicole Louise Rose)
WORKS AT: 59 Cissbury Ring South, London N12 7BG (Building Owner: Somani Portfolio Ltd)
DATE OF INSPECTION: Tuesday 22nd April 2026
PROPOSED WORKS: Loft conversion; construction of a new single-storey rear extension with new foundations within 3 metres of the Adjoining Owners' property; removal of chimney breasts; cutting into the flank wall for the purpose of installing a weathering detail.

SECTION: Front Elevation
FE-01 | The subject property forms part of a semi-detached pair, linked to the Building Owner's property at No. 59. The party wall is slightly raised above the Building Owner's roof level, with lead flashing tucked down the abutment and lapped beneath the Building Owner's roof covering. The arrangement appeared weathertight at the time of inspection. | Record only
FE-02 | The external facing brickwork is in generally good condition throughout the front elevation. No significant structural defects or widespread deterioration were observed. | Record only
FE-03 | To the front bay window, spanning ground to first floor level, a discrete area of missing pointing is present in a vertical alignment, centrally positioned within the bay. The void is approximately equivalent in extent to one full brick in size. No associated cracking or displacement of surrounding masonry is evident. | Record pre-existing defect. Monitor during works.
FE-04 | The roof covering appears in good condition and is assessed to be relatively recently renewed, exhibiting only minor and isolated areas of moss growth. No lifting, slippage or displacement of roof tiles is noted. | Record only
FE-05 | A shared central chimney stack is present at the ridge. The lead flashing to the Building Owner's side of the stack appears in good condition, with no visible lifting, displacement or deterioration at the time of inspection. | Record only

SECTION: Loft Space
LS-01 | The dormer cheek is constructed of plasterboard fixed to a timber frame. The structural member at ridge level is formed in timber; no steel beam is present at this location. | Record only
LS-02 | At the junction between the bulkhead and the dormer cheek, a vertical hairline crack is present, extending approximately 1.0-1.1 metres downward from the corner. The crack is consistent with differential movement at the interface of two separate elements. | Record pre-existing defect
LS-03 | At the underside of the timber member supporting the central light fitting, where it meets the dormer cheek on the Building Owner's side, a slight open joint is visible along the line of abutment. | Record pre-existing defect
LS-04 | To the front elevation side of the ridge, at its junction with the roof slope, a faint hairline crack extends downward along the face of the dormer cheek for a distance of approximately 1.5 metres, dissipating toward the eaves level. | Record pre-existing defect
LS-05 | At the top right-hand corner of the Velux window (the corner in closest proximity to the Building Owner's side), a vertical hairline crack extends approximately 250mm upward toward the ridge. The crack then bifurcates, with a horizontal branch extending toward the dormer cheek and continuing to the junction with the pitched roof slope. The crack is traced internally into the Velux reveal, running along the junction of the head and right-hand side reveal, terminating at the frame abutment. Refer to photographs. | Record pre-existing defect. To be monitored during and following notifiable works.
LS-06 | To the rear dormer, which comprises a central sliding door flanked by fixed glazed panes, intermittent vertical cracking is noted at the junction between the fixed pane closest to the Building Owner's side and the dormer cheek. Additional cracking is present along the head of the glazing where it meets the ceiling, extending continuously across the sliding door and adjacent fixed glazing. | Record pre-existing defect
LS-07 | At the base of the fixed glazed pane closest to the Building Owner's side, at its junction with the sliding door frame, a pronounced crack and open joint is present. This crack tapers from a notably wider opening at low level to a hairline at mid-height, becoming intermittent as it continues toward the head of the frame. | Record pre-existing defect. Nature and extent to be re-assessed post-works.
LS-08 | Within the front eaves void, the line of the party wall is not visible owing to the presence of boarding and plasterboard lining. No defects are noted to the visible elements within this void and the general condition appears satisfactory. | Record only. Inaccessible area noted.
LS-09 | Ceiling finishes throughout the loft space are generally in good condition. No defects are noted, with the exception of those associated with the Velux window and front roof slope junction as described at LS-04 and LS-05 above. | Record only
LS-10 | At the top right-hand corner of the loft door architrave, a hairline crack extends vertically to the underside of the dormer bulkhead. This defect is considered remote from the notifiable works and is recorded photographically. | Record only — remote from notifiable works

SECTION: First Floor — Front Bedroom
FF-01 | The party wall within the front bedroom is fully concealed behind full-height fitted wardrobes with a lined backing to both faces. The central chimney breast appears to have been partially concealed, with its base obscured by a chest of drawers. No direct inspection of the party wall face was possible in these areas. | Record only. Access restricted.
FF-02 | At the junction between the fitted wardrobes and the presumed chimney breast recess, symmetrical vertical hairline open joints are present on both sides, extending from cornice level down to the underside of the first shelf. The symmetrical nature of this cracking is consistent with differential movement between the chimney breast and flanking elements. | Record pre-existing defect
FF-03 | To the exposed sections of the chimney breast, widespread faint and intermittent hairline cracking is present throughout. At ceiling level, a continuous open joint and associated crack runs along the full width of the abutment between the chimney breast face and ceiling soffit, extending the full width between the wardrobes. | Record pre-existing defect
FF-04 | The cracking described at FF-03 continues onto the face of the left-hand fitted wardrobe, extending across toward the front elevation and wrapping around the corner of the unit. | Record pre-existing defect
FF-05 | To the right-hand side of the chimney breast, a similar pattern of cracking is present along the ceiling junction, extending across the ceiling plane toward the wall abutting the rear bedroom. A vertical open joint is noted at the junction of the fitted wardrobe and the flanking wall. | Record pre-existing defect
FF-06 | To the wall abutting the rear bedroom, a complex crack pattern is recorded: a horizontal hairline crack approximately 350mm in length at mid-height; branching upward to ceiling level; and continuing downward to socket level, with further multiple hairline branches radiating from the socket position. A diagonal crack extends from the vertical crack at approximately 1.0m above finished floor level, tracking toward a picture location on the adjacent wall. | Record pre-existing defect. Pattern to be photographically monitored.
FF-07 | Additional cracking is present around the picture location and radiator, including cracks which extend behind the fittings and re-emerge, forming an arching crack pattern which tracks toward the door opening. The full extent of cracking in these areas is partially obscured by furnishings. | Record pre-existing defect. Refer to photographs.
FF-08 | To the MDF face above the doors of the left-hand fitted wardrobe unit, open joints are present at panel junctions. A crack is noted at the top left-hand corner and along the ceiling junction extending approximately 350mm. | Record pre-existing defect
FF-09 | The front bay window comprises six sections. Open joints are present at the base of each frame where they meet the window cill. The section of the bay window in closest proximity to the Building Owner's property exhibits an open joint extending approximately 80-90mm up the side of the frame. | Record pre-existing defect
FF-10 | At the internal junction of the bay window reveal and the party wall, intermittent vertical hairline cracking is present. | Record pre-existing defect
FF-11 | The window casement closest to the Building Owner's side was secured in the locked position at the time of inspection and was not tested for operation. | Record — not tested
FF-12 | Minor cracking is noted at the window sill (bottom left corner) and above the door opening. These defects are considered remote from the notifiable works and are recorded photographically only. | Record only — remote from notifiable works

SECTION: First Floor — Rear Bedroom
FR-01 | The chimney breast within the rear bedroom is concealed behind wall finishes. A full-height fitted wardrobe is positioned to the right of the chimney breast and floating shelves with a desk are located to the left. | Record only. Chimney breast concealed — direct inspection not possible.
FR-02 | Above the uppermost shelf on the party wall, a diagonal hairline crack extends upward toward the ceiling. The crack is consistent with restraint and differential movement at the interface of the party wall and ceiling plane. | Record pre-existing defect
FR-03 | A complex pattern of cracking is recorded to the face of the chimney breast: (i) a vertical and diagonal crack extending from the top left-hand corner downward toward a mirror fitting; (ii) a vertical crack to the right of the mirror, extending upward and branching toward the front elevation; (iii) two horizontal cracks extending from behind the mirror toward the fitted wardrobe, with a vertical branch extending downward; and (iv) a further horizontal crack to the left of the mirror, with branches extending both upward and downward. The cracking pattern is consistent with long-term thermal movement and differential settlement at the chimney breast. | Record pre-existing defect. Extent photographically recorded.
FR-04 | At skirting level, along the base of the chimney breast, a horizontal open joint extends approximately 400mm. This is consistent with movement between the chimney breast and the adjacent floor finish. | Record pre-existing defect
FR-05 | To the wall abutting the front bedroom, a diagonal crack originating approximately 1.0m from the party wall extends downward for approximately 900mm. This crack continues onto the ceiling plane in a quadrant configuration. A secondary crack branches downward toward the adjacent shelving unit. | Record pre-existing defect
FR-06 | Above the desk, a horizontal crack extends outward from the party wall and branches upward at the far end of the desk. The crack is consistent with restraint cracking at the wall/ceiling junction in proximity to the party wall. | Record pre-existing defect
FR-07 | To the rear bedroom window: an open joint is present at the base of the frame where it meets the wall, extending onto the adjacent wall surface with associated branching. A diagonal crack is noted at the top left-hand corner, extending toward the ceiling. The MDF window sill exhibits an open joint along its wall abutment, the right-hand end being more pronounced. | Record pre-existing defect
FR-08 | To the ceiling: staining is visible, indicative of historic water ingress. The affected area was dry at the time of inspection. A zigzag crack extends from the rear wall toward the centre of the ceiling with branching. Two vertical cracks are present above the window opening. A further crack is noted at the top right-hand corner, continuing onto the ceiling plane. A quadrant-shaped crack extends across the ceiling. Refer to photographs for full extent. | Record pre-existing defect. Source of historic water ingress to be investigated if reactivated during works.

SECTION: Ground Floor — Rear Extension
GR-01 | Full-width sliding doors to the rear elevation open and close without impediment. The locking mechanism operates correctly. No visible defects are noted to the glazing, frames or threshold. | Record only
GR-02 | A gap and open joint is present between the floor tiling and the base of the sliding door frame along the full width of the threshold. | Record pre-existing defect
GR-03 | The property has been extended to the rear. Structural beams are present but concealed within the wall and ceiling construction. Technical confirmation is required as to whether sequential excavation and underpinning is necessary in connection with the proposed foundation works; failing this, written confirmation from a suitably qualified Structural Engineer should be provided to the Two Surveyors prior to commencement of notifiable works. | Further investigation required — see Discussion Items
GR-04 | At the junction of the flank wall and the rear elevation, above the sliding door head, a vertical open joint extends onto the ceiling soffit and continues along the flank wall for approximately 1.5 metres. This defect is in proximity to the proposed notifiable works. | Record pre-existing defect. To be monitored throughout the works.
GR-05 | No defects are noted to skirting junctions throughout the extension. The decorative finishes are in generally good condition throughout. | Record only
GR-06 | The wood-effect tiled floor finish is in good condition throughout the area in proximity to the notifiable works. At the far end of the room, remote from the notifiable works, localised lifting of tiles and loss of grout is noted. This is recorded photographically. | Record only — remote defect noted photographically

SECTION: Ground Floor — Front Room
GF-01 | The floor tiles throughout the front reception room are in good condition. No cracking, lifting or other defects are noted. | Record only
GF-02 | The chimney breast within the front room is boarded over. No defects are noted to the visible surface of the party wall or the boarded chimney breast face. | Record only. Chimney breast concealed.
GF-03 | A vertical crack is present in the plaster finish approximately 1.0m from the party wall, extending full height from floor level to ceiling. The crack is consistent with shrinkage or restraint cracking and does not appear to be of structural significance. It is, however, in proximity to the proposed notifiable works and should be monitored. | Record pre-existing defect. Monitor during and following works.

SECTION: External Rear
ER-01 | The rear extension is externally clad in tongue and groove timber boarding. The cladding is in good condition throughout. No defects, deterioration or displacement are noted. | Record only
ER-02 | The patio at ground level comprises large-format paving slabs laid to a fall toward a linear drainage channel. The slabs and drainage channel are in generally good condition. | Record only
ER-03 | At the corner nearest to the sliding doors and flank wall junction, a cracked paving slab is present and an open joint is noted between adjacent slabs. Slight movement of the slabs is detectable at this location. | Record pre-existing defect
ER-04 | To the rendered face below the patio step, horizontal cracking is present, extending in the direction of the boundary. Localised loss of render has occurred at points along this run, revealing the underlying brickwork substrate. On inspection, the cracking appears confined to the render layer and does not appear to extend into the structural masonry. | Record pre-existing defect. Render layer only — monitor during works.
ER-05 | No defects are noted to the timber boundary fencing or associated cladding. | Record only

END OF COMPLETE REFERENCE DOCUMENT`;

// ─── Stage 2: Professional drafting — section-level, direct rows ───────────────
export async function draftFromClaims(claims, projectMeta, apiKey, modelMode, rawNotes) {
  const resolvedMode = 'gpt-5.6-terra'; // Stage 2 hardcoded to Terra
  const model = 'gpt-5.6-terra';
  const params = { max_completion_tokens: 32000 };

  const boAddress     = projectMeta.bo_address    || 'Not provided';
  const aoAddress     = projectMeta.ao_address    || 'Not provided';
  const inspDate      = projectMeta.inspection_date
    || new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const proposedWorks = projectMeta.proposed_works || 'Not specified';

  // Build full raw transcript in sequence
  const fullTranscript = rawNotes
    ? Object.entries(rawNotes)
        .sort(([a],[b]) => Number(a) - Number(b))
        .map(([seq, text]) => '[' + seq + '] ' + text)
        .join('\n\n')
    : '';

  // Build active claims checklist (structured facts, not prose)
  const contextualTypes = new Set(['contextual', 'section_transition', 'award_note']);
  const activeClaims = claims.filter(c => c.status === 'active' && !contextualTypes.has(c.claim_type));
  const supersededClaims = claims.filter(c => c.status === 'superseded');

  const checklistLines = activeClaims.map(c => {
    const facts = [];
    if (c.element)            facts.push('Element: ' + c.element);
    if (c.construction && c.finish) facts.push('Construction/finish: ' + c.construction + ', ' + c.finish);
    else if (c.construction)  facts.push('Construction: ' + c.construction);
    else if (c.finish)        facts.push('Finish: ' + c.finish);
    if (c.condition)          facts.push('Condition: ' + c.condition);
    if (c.defect_type)        facts.push('Defect: ' + c.defect_type);
    if (c.location)           facts.push('Location: ' + c.location);
    if (c.direction)          facts.push('Direction: ' + c.direction);
    if (c.measurement)        facts.push('Measurement: ' + c.measurement);
    if (c.extent)             facts.push('Extent: ' + c.extent);
    if (c.operational_result) facts.push('Test result: ' + c.operational_result);
    if (c.access_limitation)  facts.push('Access: ' + c.access_limitation);
    if (c.amendment_mode)     facts.push('Amendment: ' + c.amendment_mode);
    const raw = c.raw_fragment ? '  raw: "' + c.raw_fragment + '"' : '';
    return '[' + c.claim_id + '] section=' + (c.section||'?') + ' type=' + c.claim_type + '\n' +
      facts.map(f => '  ' + f).join('\n') + (raw ? '\n' + raw : '');
  }).join('\n\n');

  const supersededNote = supersededClaims.length
    ? '\n--- SUPERSEDED — DO NOT USE IN ANY ROW ---\n' +
      supersededClaims.map(c => c.claim_id + ': ' + (c.raw_fragment || c.content || '')).join('\n')
    : '';

  console.log('[soc-pipeline] Single-call draft: model=' + model + ' notes=' + Object.keys(rawNotes||{}).length + ' claims=' + activeClaims.length);

  const userPrompt = 'PROPERTY: Adjoining Owner: ' + aoAddress + ' | Building Owner: ' + boAddress + ' | Date: ' + inspDate + '\n\n' +
    '══════════════════════════════════\n' +
    'COMPLETE RAW TRANSCRIPT (read this as your primary source):\n' +
    '══════════════════════════════════\n' +
    (fullTranscript || '(no transcript available)') + '\n\n' +
    '══════════════════════════════════\n' +
    'ACTIVE CLAIMS — completeness checklist (every claim must appear in a row):\n' +
    '══════════════════════════════════\n' +
    checklistLines + supersededNote + '\n\n' +
    'Read the complete transcript above exactly as a surveyor reading rough site notes.\n' +
    'Understand the full inspection sequence, all room transitions and all amendments.\n' +
    (projectMeta?.soc_type === 'dispute' ? 'DISPUTE SOC — IMPORTANT: This is NOT a standard pre-works baseline schedule. The surveyor has provided context notes explaining the specific circumstances (works already commenced, damage reported, no award in place, private agreement etc). Read those context notes carefully and use them to draft the introduction field in the JSON. The introduction must reflect the actual situation described, not the standard pre-works baseline wording. The observations sections should be drafted as normal.\n' : '') +
    'SECTION NAMING: Use the room name exactly as the surveyor described it in the dictation. Do not apply or invent architectural terminology such as "outrigger", "annexe" or "extension" unless those exact words appear in the dictation. If the surveyor said "rear kitchen" or "kitchen family room", use that as the section title.\n' +
    'ROW MERGING: Where multiple observations relate to the same element (e.g. a door tested in multiple ways), combine them into a single row. Do not split operational tests for the same element across multiple rows. Example: if the surveyor says the main leaf opened fine and all three leaves opened fine, write one row: "The aluminium bi-folding door comprising three leaves was tested and all leaves operated satisfactorily without sticking, binding or jamming."

REMOTE FROM WORKS PHRASE — CRITICAL:
The phrase "recorded for scheduling purposes only" or "remote from the proposed notifiable works" must NEVER be invented or added by Terra. It may only appear if the surveyor explicitly said the room or area is remote from the works or documented photographically only.
This phrase must appear AT MOST ONCE per section — never repeated across multiple rows in the same section.
If the phrase already appears in one row of a section, do not include it in any other row of that section.\n' +
    'The 500mm crack: the surveyor corrected "intermittently" — use ONLY the corrected meaning: a single hairline crack extending approximately 500mm.\n' +
    'IMPORTANT: Draft ALL sections from the complete transcript — ground floor, first floor AND external areas. Do not stop until every note has been covered.\n' +
    'SECTION ORDER — MANDATORY: Sections must appear in this exact physical sequence: (1) Ground floor rooms, (2) First floor rooms, (3) Second floor rooms if present, (4) Loft or roof space LAST among internal rooms, (5) External areas, (6) Site notes. Never place loft or roof space before ground floor or first floor rooms.\n' +
    'REF LABELING: Use short two-letter prefixes describing the room only. Examples: CR = Cloakroom/Bathroom, FR = Front Room, FB = Front Bedroom, RB = Rear Bedroom, LF = Loft, EA = External Areas. Do not use long prefixes like FFFB, GFCR or FFRB.\n' +
    'SITE NOTES — MANDATORY: Populate the site_notes array with ALL of the following found in the transcript: (1) access restrictions or refusals, (2) photographic schedule statements, (3) remote-from-works statements for whole rooms, (4) structural engineer or contractor notes, (5) legal status observations (party wall, party fence wall), (6) health and safety or asbestos notes, (7) cleanup requirements. Do NOT return an empty site_notes array if any of these are present in the transcript.\n' +
    'ROOM INCLUSION RULE — CRITICAL: Every room and area inspected must appear in the schedule. Do not omit any room because it appears remote from the proposed notifiable works. If a room is remote from the works, include it and append the caveat: "Although remote from the proposed notifiable works, this has been recorded for scheduling purposes only." This applies to every inspected room without exception.\n' +
    'Every active claim must be covered. Every row must have source_claim_ids.\n\n' +
    'Return valid JSON only:\n' +
    '{\n' +
    (projectMeta?.soc_type === 'dispute' ? '  "introduction": "AI-drafted introduction paragraph based on the surveyor\'s context notes. Must reflect that works have already taken place, explain the specific circumstances (e.g. no award in place, damage reported, private agreement reached), and set out the purpose of this schedule accordingly. Professional British English. Do not use the standard pre-works baseline wording.",\n' : '') +
    '  "sections": [{"number": 1, "title": "...", "rows": [{"ref": "XX01", "row_id": "uid", "element": "...", "observation": "Professional observation.", "action": "Record only", "source_note_ids": [1], "source_claim_ids": ["c-1-1"]}]}],\n' +
    '  "site_notes": [],\n' +
    '  "general_notes": []\n' +
    '}';

  // SOC_MASTER_V1 hardcoded active — best brain + gold standard examples
  const activeSystem = SOC_MASTER_V1 + '\n\n' + SOC_RUNTIME_OUTPUT_CONTRACT + '\n\n' + FEW_SHOT_EXAMPLES_V1;

  // Try primary model, fall back to gpt-4o if it fails
  async function callModel(m, p) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240000); // 240s timeout
    let r;
    try {
      r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m, ...p, messages: [
          { role: m.startsWith('gpt-5.6') ? 'developer' : 'system', content: activeSystem },
          { role: 'user', content: userPrompt },
        ]}),
        signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error('Drafting API ' + r.status + ' (model=' + m + '): ' + errText.slice(0, 200));
    }
    return r.json();
  }

  let d;
  try {
    d = await callModel(model, params);
  } catch (primaryErr) {
    console.warn('[soc-pipeline] Primary model failed (' + model + '):', primaryErr.message, '— falling back to gpt-4o');
    if (model !== 'gpt-4o') {
      d = await callModel('gpt-4o', { temperature: 0.15, max_tokens: 16000 });
    } else {
      throw primaryErr;
    }
  }

  const raw = (d.choices?.[0]?.message?.content || '')
    .replace(/^[`]{3}(?:json)?[\s]*/m, '').replace(/[\s]*[`]{3}$/m, '').trim();

  let result;
  try { result = JSON.parse(raw); }
  catch { throw new Error('Drafting returned invalid JSON'); }

  if (!Array.isArray(result.sections) || !result.sections.length) {
    throw new Error('Drafting returned no sections');
  }

  // Assign stable row IDs
  let sectionNumber = 1;
  for (const sec of result.sections) {
    sec.number = sectionNumber++;
    for (const row of (sec.rows || []))
      if (!row.row_id) row.row_id = 'row-' + sec.number + '-' + row.ref + '-' + Date.now();
  }

  // Normalise site_notes / general_notes to strings
  const siteNotes = (result.site_notes || []).map(n =>
    typeof n === 'string' ? n : (n.observation || n.note || n.text || n.description || n.content || '')
  ).filter(Boolean);

  const generalNotes = (result.general_notes || []).map(n =>
    typeof n === 'string' ? n : (n.note || n.text || '')
  ).filter(Boolean);

  return {
    sections: result.sections,
    unresolved_notes: [],
    site_notes: siteNotes.map(t => ({ description: t })),
    general_notes: generalNotes,
    _drafting_metadata: {
      drafting_model: model,
      model_key: resolvedMode,
      stage1_model: 'gpt-5.6-luna',
      stage2_model: model,
      stage3_model: 'gpt-5.6-sol',
    },
  };
}


// ─── Completeness audit ────────────────────────────────────────────────────────
export function runCompletenessAudit(draftedResult, claims) {
  const claimIdsInRows = new Set();
  for (const s of (draftedResult.sections || []))
    for (const r of (s.rows || []))
      for (const cid of (r.source_claim_ids || [])) claimIdsInRows.add(cid);

  const skipTypes = new Set(['contextual', 'section_transition', 'award_note']);
  const activeClaims = (claims || []).filter(c => c.status === 'active');
  const missing = activeClaims.filter(c => !claimIdsInRows.has(c.claim_id));
  const substantive = missing.filter(c => !skipTypes.has(c.claim_type));

  const coverage = activeClaims.length > 0
    ? (((activeClaims.length - substantive.length) / activeClaims.length) * 100).toFixed(1)
    : '100.0';

  return {
    issues: substantive.map(c =>
      `MISSING: ${c.claim_id} type=${c.claim_type} section="${c.section}" ${(c.defect_type || c.condition || '').slice(0,60)}`),
    warnings: missing.filter(c => skipTypes.has(c.claim_type)).map(c => `Contextual not in rows: ${c.claim_id}`),
    active_claims: activeClaims.length,
    missing_substantive: substantive.length,
    coverage_percent: coverage,
  };
}

// ─── Quality audit (async, not in sync pipeline) ──────────────────────────────
export async function runQualityAudit(draftedResult, apiKey, useV1 = false) {
  const activeExamples = FEW_SHOT_EXAMPLES_V1; // hardcoded to V1 gold standard
  const rows = [];
  for (const s of (draftedResult.sections || []))
    for (const r of (s.rows || []))
      if (r.observation) rows.push({ ref: r.ref, section: s.title, observation: r.observation });
  if (!rows.length) return draftedResult;

  const corrected = {};
  for (let i = 0; i < rows.length; i += QUALITY_ROW_BATCH) {
    const batch = rows.slice(i, i + QUALITY_ROW_BATCH);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.6-sol', max_completion_tokens: 3000,
          messages: [
            { role: 'system', content: `You are a Senior Chartered Party Wall Surveyor doing the final quality review of Schedule of Condition observations before they are issued. Below are worked examples of the required professional standard — use these as your reference for correct terminology, structure and tone. Every observation you review or rewrite must match this standard.

${activeExamples}` },
            { role: 'user', content: `Review the drafted observations below against the professional standard shown in the examples.

For each row, decide:
1. Does this match the required professional standard shown in the examples? If not, rewrite it to match — correct surveying terminology, structure and tone, consistent with the examples above.
2. Fix any speech-to-text residue or grammar errors.
3. Flag (do not change) anything with a factual issue: unsupported causation/diagnosis, invented facts, or claims that don't match what was actually observed.

For every row you changed, briefly note what you changed and why in "change_note". Leave "change_note" null if unchanged.

Return: { "rows": [{ "ref": "...", "observation": "...", "flagged": false, "flag_reason": null, "change_note": null }] }
ROWS: ${JSON.stringify(batch)}` },
          ],
        }),
      });
      const d = await res.json();
      const parsed = JSON.parse((d.choices?.[0]?.message?.content || '{}').replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, ''));
      for (const r of (parsed?.rows || [])) corrected[r.ref] = r;
    } catch {}
  }

  const improved = JSON.parse(JSON.stringify(draftedResult));
  for (const s of (improved.sections || []))
    for (const r of (s.rows || [])) {
      const c = corrected[r.ref];
      if (c?.observation) r.observation = c.observation;
      if (c?.flagged) { r.flagged = true; r.flag_reason = c.flag_reason; }
      if (c?.change_note) r.quality_change_note = c.change_note;
    }
  return improved;
}

// ─── noteComplexity / modelForComplexity (used by process-soc-note.js) ────────
export function noteComplexity(note, noteType, hasCorrection) {
  const words = (note || '').split(/\s+/).length;
  const hasMeasurement = /\d+\s*(mm|cm|m\b|ft)/i.test(note);
  const defectCount = (note.match(/crack|joint|defect|stain|spall|lift/gi) || []).length;
  if (noteType === 'amendment' || hasCorrection) return 'high';
  if (words > 50 || (hasMeasurement && defectCount > 1)) return 'high';
  if (words > 25 || hasMeasurement) return 'medium';
  return 'low';
}

export function modelForComplexity(complexity) {
  return complexity === 'high' ? 'gpt-4o' : 'gpt-4o-mini';
}
