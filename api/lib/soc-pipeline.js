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
  'ground floor':                 'Ground Floor',
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
Ground Floor Front Elevation Room | Ground Floor Rear Elevation Room | Ground Floor
Rear Extension | First Floor Rear Bedroom | First Floor Front Elevation Room | External Areas

NAVIGATION PHRASES → section_transition or contextual, never observations.

AMENDMENT: If surveyor self-corrects ("Actually...", "scratch that", "correction"), mark original claim as superseded. Active claim must never contain the corrected-out wording. For the 500mm crack: the active claim must NOT contain "intermittent" or "intermittently".

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
"The party wall is finished in plaster and paint and was found to be in good condition with no visible defects noted at the time of inspection."

---

EXAMPLE 2 — Section introduction with layout context

Raw dictation: "front elevation is an open plan that extends into the extension, both chimney breasts on the front and rear removed. just to note on that last one talking about ground floor front chimney breast"
Facts:
  • claim_type: contextual/construction_description
  • Layout: open-plan arrangement extending to rear
  • Element: Chimney breast
  • Condition: Ground-floor front chimney breast removed

Required row:
"The ground floor front reception room forms part of an open-plan arrangement extending through to the rear of the property and into the later rear extension. The original ground-floor front chimney breast has been removed."

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

EXAMPLE 8 — Roof and guttering

Raw dictation: "pitch roof over extension appears to be in good condition no visible defects noted to roof tiles with a gutter overhanging the bottom of the pitch roof leading to a flat roof again no visible defects noted on the flat roof itself or surrounding upstand of the skylight over the extension"
Facts:
  • Element: Pitched roof
  • Condition: No visible defects to roof tiles
  • Element: Gutter
  • Location: Base of pitched roof slope
  • Element: Flat roof
  • Condition: No visible defects
  • Element: Rooflight upstand
  • Condition: No visible defects

Required row:
"The rear roof slope above the extension was visually inspected externally. No visible defects were noted to the roof tiles. The guttering arrangement at the base of the roof slope appeared serviceable. The flat roof covering over the extension together with the surrounding rooflight upstands appeared to be in good condition with no visible defects noted."

---

EXAMPLE 9 — External paving

Raw dictation: "laid patio no visible defects noted no open joints no raised section of slabs in vicinity of notifiable works, patio in very good condition"
Facts:
  • Element: Patio / paving
  • Condition: No cracked slabs, no open joints, no raised sections
  • Scope: Vicinity of notifiable works

Required row:
"The rear patio comprises laid paving slabs and was found to be in very good condition. No cracked paving slabs, open joints, settlement or raised sections were noted within the vicinity of the proposed notifiable works."

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
"The flank wall appears to be constructed astride the boundary line and is therefore considered to form a party wall. Given the nature of the proposed works, no disturbance to the adjoining owner's property or boundary fencing is anticipated in this location."`;

// ─── Main drafting instruction ─────────────────────────────────────────────────
const DRAFTING_SYSTEM = `You are preparing a formal Schedule of Conditions from rough field dictation under the Party Wall etc. Act 1996.

The structured claims are the factual authority. The raw notes provide context only.

Do not transcribe, lightly edit or reassemble the claim fields mechanically.

Read the full section as an experienced Party Wall Surveyor would, understand the physical layout and inspection sequence, and draft each table row from first principles in clear professional surveying language.

Every supported fact must be preserved. No unsupported fact may be introduced. The final rows must read as though they were written by an experienced surveyor from rough site notes.

GROUPING RULES:
- Combine: same element, same location, construction + finish + general condition together
- Separate: different elements, different defects, different locations, different operational tests, access limitations, site notes
- Every row must identify its element clearly
- Multi-sentence rows are correct where they cover related observations

LANGUAGE STANDARDS:
- Past tense throughout: "was noted", "was found to be", "appeared", "were observed"
- "No visible defects noted at the time of inspection" — not "good condition" alone
- Crack rows: state type, location, direction, measurement in one clear sentence
- Window tests: state element, what was tested, result
- Water ingress: state appearance at time of inspection and whether remote from works
- Access rows: state what restricts access and what was accessible
- Never use: "intermittently" for the 500mm crack (corrected by surveyor), "Bugatti wall", "plank wall", "v-locks", "sealing" for ceiling
- Precise legal language: "at the time of inspection", "for scheduling purposes only", "remote from the proposed notifiable works"

COMPLETENESS:
Every active claim must be represented in a row with its source_claim_ids recorded.
After drafting the section, verify no active claim is missing.
Return rows in logical inspection sequence.

${FEW_SHOT_EXAMPLES}`;

// ─── Stage 2: Professional drafting — section-level, direct rows ───────────────
export async function draftFromClaims(claims, projectMeta, apiKey, modelMode, rawNotes) {
  const resolvedMode = modelMode || (typeof process !== 'undefined' && process.env.SOC_DRAFT_MODEL) || 'gpt4o';
  const model  = resolvedMode === 'gpt55' ? 'gpt-5.5' : 'gpt-4o';
  const params = resolvedMode === 'gpt55'
    ? { max_completion_tokens: 16000, reasoning_effort: 'medium' }
    : { temperature: 0.15, max_tokens: 16000 };

  const boAddress     = projectMeta.bo_address    || 'Not provided';
  const aoAddress     = projectMeta.ao_address    || 'Not provided';
  const inspDate      = projectMeta.inspection_date
    || new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const proposedWorks = projectMeta.proposed_works || 'Not specified';

  // Group ALL claims by section (active and superseded)
  const sectionOrder = [], claimsBySection = {};
  for (const c of claims) {
    const sec = c.section || 'Unallocated';
    if (!claimsBySection[sec]) { claimsBySection[sec] = []; sectionOrder.push(sec); }
    claimsBySection[sec].push(c);
  }
  const uniqueSections = [...new Set(sectionOrder)];

  // Build claim-count-aware batches (max 25 active claims per batch)
  const activeCounts = {};
  for (const sec of uniqueSections) {
    activeCounts[sec] = (claimsBySection[sec] || []).filter(c => c.status === 'active').length;
  }

  const batches = [];
  let currentBatch = [], currentCount = 0;
  for (const sec of uniqueSections) {
    const cnt = activeCounts[sec] || 0;
    if (cnt > MAX_CLAIMS_PER_BATCH) {
      if (currentBatch.length) { batches.push(currentBatch); currentBatch = []; currentCount = 0; }
      const secClaims = (claimsBySection[sec] || []).filter(c => c.status === 'active');
      for (let j = 0; j < secClaims.length; j += MAX_CLAIMS_PER_BATCH) {
        const partNum = Math.floor(j / MAX_CLAIMS_PER_BATCH) + 1;
        const pseudoSec = partNum === 1 ? sec : `${sec} (Part ${partNum})`;
        batches.push([pseudoSec]);
        claimsBySection[pseudoSec] = [
          ...secClaims.slice(j, j + MAX_CLAIMS_PER_BATCH),
          ...(claimsBySection[sec] || []).filter(c => c.status === 'superseded'),
        ];
      }
    } else if (currentCount + cnt > MAX_CLAIMS_PER_BATCH && currentBatch.length) {
      batches.push(currentBatch); currentBatch = [sec]; currentCount = cnt;
    } else {
      currentBatch.push(sec); currentCount += cnt;
    }
  }
  if (currentBatch.length) batches.push(currentBatch);

  const allSections = [], allAwardNotes = [], allGeneralNotes = [];
  let sectionNumber = 1;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batchSections = batches[batchIdx];
    const claimCount = batchSections.reduce((s, sec) => s + (activeCounts[sec] || 0), 0);
    console.log(`[soc-pipeline] Drafting batch ${batchIdx+1}/${batches.length}: ${batchSections.join(', ')} (${claimCount} active claims) model=${model}`);

    // Build factual checklist for this batch
    const batchClaimsAll = batchSections.flatMap(sec => claimsBySection[sec] || []);
    const checklist = buildFactualChecklist(batchClaimsAll, null);

    // Build raw notes text for this batch's sections
    const batchNoteSeqs = new Set(batchClaimsAll.map(c => c.source_note_id || c.note_sequence).filter(Boolean));
    const rawNotesForBatch = rawNotes
      ? Object.entries(rawNotes)
          .filter(([seq]) => batchNoteSeqs.has(Number(seq)))
          .sort(([a],[b]) => Number(a)-Number(b))
          .map(([seq, text]) => `[${seq}] ${text}`)
          .join('\n\n')
      : '';

    const userPrompt = `SECTIONS TO DRAFT (starting at section number ${sectionNumber}):
${batchSections.map(s => `  • ${s}`).join('\n')}

PROPERTY CONTEXT:
  Adjoining Owner: ${aoAddress}
  Building Owner: ${boAddress}
  Date of Inspection: ${inspDate}
  Proposed Works: ${proposedWorks}

RAW DICTATION (primary source — read and interpret this):
${rawNotesForBatch || '(use structured claims below as source)'}

ACTIVE CLAIMS — every claim below must appear in at least one row:
${checklist}

Instructions:
Read the raw dictation above as an experienced Party Wall Surveyor reading rough site notes.
Use the active claims as your completeness checklist — every claim must be covered.
Write professional SOC table rows from first principles, not by reformatting the claim fields.
The raw dictation provides context, construction, sequence and professional interpretation.
The claims ensure nothing is missed and no superseded wording is used.


Return JSON only:
{
  "sections": [
    {
      "number": N,
      "title": "exact section name",
      "rows": [
        {
          "ref": "GFF01",
          "row_id": "unique-stable-id",
          "element": "party wall",
          "observation": "Multi-sentence professional observation written from first principles. Not a reformatting of field labels.",
          "action": "Record only",
          "source_note_ids": [1, 2],
          "source_claim_ids": ["c-1-1", "c-1-2"]
        }
      ]
    }
  ],
  "site_notes": [],
  "general_notes": []
}`;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, ...params,
          messages: [
            { role: 'system', content: DRAFTING_SYSTEM },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Drafting API ${res.status}`);
      const d = await res.json();
      const raw = (d.choices?.[0]?.message?.content || '')
        .replace(/^[`]{3}(?:json)?\s*/m, '').replace(/\s*[`]{3}$/m, '').trim();
      const batchResult = JSON.parse(raw);

      for (const sec of (batchResult.sections || [])) {
        sec.number = sectionNumber++;
        for (const row of (sec.rows || []))
          if (!row.row_id) row.row_id = `row-${sec.number}-${row.ref}-${Date.now()}`;
        allSections.push(sec);
      }
      for (const n of (batchResult.site_notes || [])) {
        const text = typeof n === 'string' ? n : (n.note || n.text || n.description || '');
        if (text) allAwardNotes.push({ description: text });
      }
      for (const n of (batchResult.general_notes || [])) {
        const text = typeof n === 'string' ? n : (n.note || n.text || '');
        if (text) allGeneralNotes.push(text);
      }
    } catch (e) {
      console.warn(`[soc-pipeline] Drafting batch ${batchIdx+1} failed:`, e.message);
    }
  }

  if (!allSections.length) throw new Error('Drafting returned no sections');

  return {
    sections: allSections,
    unresolved_notes: [],
    award_notes: allAwardNotes,
    general_notes: allGeneralNotes,
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
