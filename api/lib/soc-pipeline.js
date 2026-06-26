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
  'ground floor':                 'Ground Floor Rear Extension',
  'extended area':                'Rear Extension',
  'rear extension':               'Rear Extension',
  'first floor rear bedroom':     'First Floor Rear Bedroom',
  'rear bedroom':                 'First Floor Rear Bedroom',
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
Ground Floor Front Elevation Room | Ground Floor Rear Elevation Room | Ground Floor Rear Extension | First Floor Rear Bedroom | First Floor Front Elevation Room | External Areas

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
      model: 'gpt-4o', temperature: 0.05, max_tokens: 8000,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
  })
  .then(r => r.json())
  .then(d => {
    const raw = (d.choices?.[0]?.message?.content || '').replace(/^[`]{3}(?:json)?\s*/m, '').replace(/\s*[`]{3}$/m, '').trim();
    try { return JSON.parse(raw).claims || []; } catch { return []; }
  })
  .catch(() => []);
}

// ─── Build factual checklist for drafting (not database labels) ────────────────
function buildFactualChecklist(claims, rawNotesBySeq) {
  const contextualTypes = new Set(['contextual', 'section_transition']);
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
      for (const f of facts) lines.push(`  • ${f}`);
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

EXAMPLE 1 — Room context and construction/finish/condition

Raw dictation: "party wall plaster paint finish no visible defects"
Facts:
  • Element: Party wall
  • Construction and finish: Plastered and painted
  • General condition: No visible defects

Required row:
"The party wall is finished in plaster and paint and appeared generally free from visible defects at the time of inspection."

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
"No visible defects were noted in the ceiling."`;

// ─── Main drafting instruction ─────────────────────────────────────────────────
const DRAFTING_SYSTEM = `You are preparing a formal Schedule of Conditions under the Party Wall etc. Act 1996 from rough field dictation.

You are not assembling prewritten claim sentences and you are not lightly editing the surveyor's dictation.

Read the complete inspection record as a whole. Use the structured claims as the factual authority and completeness checklist. Use the raw notes, sequence and context to understand the inspection. Then write the Schedule of Conditions from first principles as an experienced Party Wall Surveyor would write it.

PROCESS:
1. Read the full raw dictation for this section — this is your primary source.
2. Understand the physical layout, inspection sequence and any room transitions.
3. Note all amendments and corrections — use only the corrected final meaning.
4. Check every active claim is represented in your rows.
5. Draft professional table rows from first principles.
6. OUT-OF-SEQUENCE NOTES — CRITICAL: Surveyors sometimes dictate a note for a room they have already left (e.g. "I'm just moving temporarily back to the first floor rear bedroom" or "continuing in the front elevation room"). These out-of-sequence notes must be assigned to the correct room regardless of where they appear in the transcript. Do not drop them because they appear after a section transition. Example: a window test dictated after external notes still belongs in the First Floor Rear Bedroom section. A ceiling condition noted after returning to a room still belongs in that room. Always place the observation in the section it describes, not the section currently active when the note was dictated.

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
- Combine: construction + finish + general condition of the same element; related observations at same location
- Separate: different elements, different defects, different locations, different tests
- Include layout context rows (open-plan arrangement, removed chimney breasts, transitions)
- Include ALL rooms and areas the surveyor entered and recorded, without exception — do not omit any room on the basis that it is remote from the proposed notifiable works or unlikely to be affected. Where a room or element is remote from the works, include it with the caveat: "Although remote from the proposed notifiable works, this has been recorded for scheduling purposes only."
- Where a room was recorded by photograph only, or where access was restricted, it must still appear as its own named section with a row stating the method of recording and the reason. Example: "The loft bedroom was recorded by photographic record only. The area is remote from the proposed notifiable works and no physical inspection was carried out. The photographs are retained on file." Do NOT omit photograph-only rooms — omission implies the room was never visited.
- Where a surveyor notes that a room was scheduled using photographs only because it is remote from notifiable works, that note must produce a named section for that room, not a site note entry, unless the dictation explicitly directs it to site notes.
- Where NO ACCESS was available to a room at the time of inspection (access refused, locked, not granted), that room must appear as its own named section with a row stating: "No access was available to [room] at the time of inspection. [Reason if given.] This has been recorded accordingly." Do not omit it — failure to document no-access implies the room was never attempted.
- Where access was RESTRICTED (partial access only, elements obscured by furniture, fixed finishes or fittings), this is a site note entry, not a named section row. Example site note: "Access to [element] was restricted at the time of inspection due to [reason]. Only accessible sections were inspected and recorded."
- Sections must be ordered to follow the physical inspection sequence: basement (if present), ground floor rooms, first floor rooms, second floor rooms, loft or roof space last, then external areas, then site notes. Loft and roof space always appear after all habitable floor levels — never before ground floor rooms.
- Where the surveyor states that a room or area is remote from the notifiable works AND was recorded by photographic schedule only, this must generate BOTH: (1) a named section for that room with its observations, AND (2) a site note entry recording that the area is remote from the proposed notifiable works and was recorded by photographic schedule only, with the photographs retained on file. Example site note: "The loft was inspected and found to be remote from the proposed notifiable works. The inspection was carried out by photographic schedule only. The photographs are retained on file."
- Where the surveyor explicitly instructs that a note should be added to a different room ("also add to the front bedroom", "add that note to the front bedroom", "same applies to the front bedroom"), that observation must be duplicated into the named room regardless of where it appears in the transcript. Do not drop cross-room carry-forward instructions.
- Where the surveyor identifies a plasterboard pop, that must be recorded as a plasterboard pop — not compressed into a generic crack description. Example: "evidence of a prior plasterboard pop that has been decorated over" must appear in the row, not be replaced with "small crack."
- Flank wall / party fence wall legal status notes belong in site_notes array, not as observation rows
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


// ─── Stage 2: Professional drafting — section-level, direct rows ───────────────
export async function draftFromClaims(claims, projectMeta, apiKey, modelMode, rawNotes) {
  const resolvedMode = modelMode || (typeof process !== 'undefined' && process.env.SOC_DRAFT_MODEL) || 'gpt4o';
  // Model selection — gpt55=gpt-5.5, gpt5=gpt-5, anything else=gpt-4o
  const model = resolvedMode === 'gpt55' ? 'gpt-5.5'
              : resolvedMode === 'gpt54' ? 'gpt-5.4'
              : resolvedMode === 'gpt5'  ? 'gpt-5'
              : 'gpt-4o';
  const isGpt5Family = ['gpt55','gpt54','gpt5'].includes(resolvedMode);
  const params = isGpt5Family
    ? { max_completion_tokens: 32000, reasoning_effort: 'medium' }
    : { temperature: 0.15, max_tokens: 16383 };

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
  const contextualTypes = new Set(['contextual', 'section_transition']);
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
    'The 500mm crack: the surveyor corrected "intermittently" — use ONLY the corrected meaning: a single hairline crack extending approximately 500mm.\n' +
    'IMPORTANT: Draft ALL sections from the complete transcript — ground floor, first floor AND external areas. Do not stop until every note has been covered.\n' +
    'SECTION ORDER — MANDATORY: Sections must appear in this exact sequence: (1) Ground floor rooms in inspection order, (2) First floor rooms in inspection order, (3) Second floor rooms if present, (4) Loft or roof space LAST among internal rooms, (5) External areas, (6) Site notes. Never place loft or roof space before ground floor or first floor rooms. Never reverse this order.\n' +
    'ROOM INCLUSION RULE — CRITICAL: Every room and area inspected must appear in the schedule. Do not omit any room because it appears remote from the proposed notifiable works. If a room is remote from the works, include it and append the caveat: "Although remote from the proposed notifiable works, this has been recorded for scheduling purposes only." This applies to every inspected room without exception.\n' +
    'REF LABELING: Use short two-letter prefixes describing the room only. Examples: CR = Cloakroom/Bathroom, FR = Front Room, FB = Front Bedroom, RB = Rear Bedroom, LF = Loft, EA = External Areas. Do not use long prefixes like FFFB, GFCR or FFRB.\n' +
    'SITE NOTES — MANDATORY: Populate the site_notes array with ALL of the following found in the transcript: (1) access restrictions or refusals, (2) photographic schedule statements (e.g. loft recorded by photograph only), (3) remote-from-works statements for whole rooms or areas, (4) structural engineer or contractor notes, (5) legal status observations (party wall, party fence wall), (6) health and safety or access notes. Do NOT return an empty site_notes array if any of these are present in the transcript. Example: if the surveyor says the loft is remote from notifiable works and recorded by photographic schedule only, that must appear as a site note.\n' +
    'Every active claim must be covered. Every row must have source_claim_ids.\n\n' +
    'Return valid JSON only:\n' +
    '{\n' +
    (projectMeta?.soc_type === 'dispute' ? '  "introduction": "AI-drafted introduction paragraph based on the surveyor\'s context notes. Must reflect that works have already taken place, explain the specific circumstances (e.g. no award in place, damage reported, private agreement reached), and set out the purpose of this schedule accordingly. Professional British English. Do not use the standard pre-works baseline wording.",\n' : '') +
    '  "sections": [{"number": 1, "title": "...", "rows": [{"ref": "XX01", "row_id": "uid", "element": "...", "observation": "Professional observation.", "action": "Record only", "source_note_ids": [1], "source_claim_ids": ["c-1-1"]}]}],\n' +
    '  "site_notes": [],\n' +
    '  "general_notes": []\n' +
    '}';

  // Try primary model, fall back to gpt-4o if it fails
  async function callModel(m, p) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m, ...p, messages: [
        { role: 'system', content: DRAFTING_SYSTEM },
        { role: 'user', content: userPrompt },
      ]}),
    });
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
    },
  };
}


// ─── Completeness audit ────────────────────────────────────────────────────────
export function runCompletenessAudit(draftedResult, claims) {
  const claimIdsInRows = new Set();
  for (const s of (draftedResult.sections || []))
    for (const r of (s.rows || []))
      for (const cid of (r.source_claim_ids || [])) claimIdsInRows.add(cid);

  const skipTypes = new Set(['contextual', 'section_transition']);
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
export async function runQualityAudit(draftedResult, apiKey) {
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
          model: 'gpt-4o', temperature: 0.1, max_tokens: 3000,
          messages: [
            { role: 'system', content: 'Return valid JSON only.' },
            { role: 'user', content: `Review observations. Fix only speech-to-text residue and obvious grammar errors. Flag factual issues without changing them.\nReturn: { "rows": [{ "ref": "...", "observation": "...", "flagged": false, "flag_reason": null }] }\nROWS: ${JSON.stringify(batch)}` },
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
