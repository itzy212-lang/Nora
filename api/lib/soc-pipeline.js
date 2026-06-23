// api/lib/soc-pipeline.js
// SOC pipeline: claim extraction, professional drafting, quality and completeness audits.

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
  [/\bgrounds?\b(?= (joint|crack))/gi, 'grout'],
];

export function applySttCorrections(text) {
  let out = text || '';
  for (const [pattern, replacement] of STT_CORRECTIONS) out = out.replace(pattern, replacement);
  return out;
}

// ─── Navigation phrases that must never become SOC rows ───────────────────────
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
  'extension':                    'Rear Extension',
  'first floor rear bedroom':     'First Floor Rear Bedroom',
  'rear bedroom':                 'First Floor Rear Bedroom',
  'first floor front elevation':  'First Floor Front Elevation Room',
  'front elevation room first':   'First Floor Front Elevation Room',
  'external':                     'External Areas',
  'external areas':               'External Areas',
  'externally':                   'External Areas',
};

export function canonicalSection(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  for (const [key, val] of Object.entries(SECTION_ALIASES)) {
    if (lower.includes(key)) return val;
  }
  // Capitalise first letter of each word
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

    // Carry the last declared section forward
    const lastWithSection = [...batchClaims].reverse().find(c => c.section && c.status !== 'contextual');
    if (lastWithSection?.section) currentSection = lastWithSection.section;

    allClaims = allClaims.concat(batchClaims);
  }

  // Normalise sections and filter navigation
  return allClaims
    .filter(c => c.claim_type !== 'section_transition')
    .map(c => ({ ...c, section: canonicalSection(c.section) || c.section }));
}

const EXTRACTION_SYSTEM = `You are extracting structured factual claims from Party Wall site inspection notes dictated by a surveyor.

CRITICAL: Store FACTS in structured fields. Do NOT write finished prose sentences. The "content" field should be a minimal factual summary, not a polished sentence.

SPEECH-TO-TEXT CORRECTIONS — apply automatically:
- "bugatti wall" → "party wall"
- "plank wall" / "blank wall" → "flank wall"
- "v-locks" / "v locks" / "velocks" → "VELUX"
- "sealing" (ceiling context) → "ceiling"
- "real evasion wall" / "rear evasion wall" → "rear elevation wall"
- "kitched roof" → "pitched roof"
- "tarps floor" / "tarp floor" → "tiled floor"
- "UPBC" → "UPVC"
- "scheduler" → "schedule"

SECTION NAMES — use EXACTLY these names based on context:
- Ground Floor Front Elevation Room
- Ground Floor Rear Elevation Room
- Ground Floor
- Rear Extension
- First Floor Rear Bedroom
- First Floor Front Elevation Room
- External Areas

NAVIGATION PHRASES — classify as section_transition or contextual, NEVER as condition observations:
- "Continuing the schedule of conditions on the first floor rear bedroom" → section_transition to First Floor Rear Bedroom
- "Continuing the scheduler conditions off to the rear" → section_transition to External Areas
- "Standing inside the rear elevation room" → contextual
- "We now enter the extended area" → section_transition to Rear Extension
- "Off the rear elevation wall we now enter..." → section_transition to Rear Extension
- "Just to note on that last one..." → amendment introduction
- "I'm just moving temporarily back..." → amendment to previous section
- Any phrase starting with "Okay, so continuing" or "So off the" → section_transition

AMENDMENT DETECTION — if the surveyor corrects themselves mid-note:
- Words like "Actually", "scratch that", "correction", "just to amend", "I mean" signal a correction
- Mark the initial (incorrect) content as superseded
- The corrected version is the active claim
- CRITICAL: The 500mm crack note says "intermittently" then corrects to a plain hairline crack — the active claim must NOT contain "intermittently"

CLAIM TYPES: section_transition | construction_description | finish_description | general_condition | specific_defect | operational_test | access_limitation | site_note | contextual | amendment | award_note

Return JSON only: { "claims": [ ... ] }`;

function _extractBatch(notesText, carrySection, apiKey) {
  const sectionCtx = carrySection ? `CURRENT ACTIVE SECTION: ${carrySection}\n\n` : '';

  const prompt = `${sectionCtx}Extract atomic structured claims from these Party Wall site inspection notes.

Each claim MUST have these fields:
- claim_id: "c-{noteNum}-{seqNum}"
- source_note_id: N (note number in sequence)
- note_sequence: N
- claim_sequence: N (sequence within note, starting 1)
- claim_type: one of the types above
- section: exact canonical section name
- element: specific building element (e.g. "party wall", "ceiling", "skirting", "window")
- construction: material/build type or null (e.g. "plasterboard", "porcelain tile", "brickwork")
- finish: surface finish or null (e.g. "painted", "plastered", "tiled")
- condition: overall condition or null (e.g. "no visible defects", "satisfactory")
- defect_type: type of defect or null (e.g. "hairline crack", "open joint", "water staining")
- location: position/location description or null (e.g. "left-hand corner", "top of skirting")
- direction: crack/defect direction or null (e.g. "diagonal", "vertical", "horizontal")
- measurement: size/extent with units or null (e.g. "400mm", "600-700mm")
- extent: how far it extends or null (e.g. "from front elevation to rear elevation wall")
- operational_result: for tests — result or null (e.g. "opens and closes without sticking")
- access_limitation: what restricts access or null
- raw_fragment: the corrected verbatim text from the note that this claim comes from
- status: "active" | "superseded" | "contextual"
- amendment_mode: null | "replace" | "correct_measurement" | "correct_location" | "qualify" | "withdraw" | "supplement"
- superseded_by: null or claim_id of replacing claim
- confidence: "high" | "medium" | "low"

NOTES:
${notesText}`;

  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.05,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
  })
  .then(r => r.json())
  .then(d => {
    const raw = (d.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    try { return JSON.parse(raw).claims || []; } catch { return []; }
  })
  .catch(() => []);
}

// ─── Build claim summary for drafting (uses structured fields, not prose) ──────
function buildDraftInput(batchSections, claimsBySection) {
  return batchSections.map(sec => {
    const claims = (claimsBySection[sec] || []).filter(c => c.status === 'active');
    if (!claims.length) return null;

    const rows = claims.map(c => {
      const parts = [`[${c.claim_id}] type=${c.claim_type}`];
      if (c.element)            parts.push(`element="${c.element}"`);
      if (c.construction)       parts.push(`construction="${c.construction}"`);
      if (c.finish)             parts.push(`finish="${c.finish}"`);
      if (c.condition)          parts.push(`condition="${c.condition}"`);
      if (c.defect_type)        parts.push(`defect="${c.defect_type}"`);
      if (c.location)           parts.push(`location="${c.location}"`);
      if (c.direction)          parts.push(`direction="${c.direction}"`);
      if (c.measurement)        parts.push(`measurement="${c.measurement}"`);
      if (c.extent)             parts.push(`extent="${c.extent}"`);
      if (c.operational_result) parts.push(`test_result="${c.operational_result}"`);
      if (c.access_limitation)  parts.push(`access="${c.access_limitation}"`);
      if (c.amendment_mode)     parts.push(`amendment=${c.amendment_mode}`);
      const line = parts.join(' | ');
      const raw = c.raw_fragment ? `  raw: "${c.raw_fragment}"` : '';
      return raw ? `${line}\n${raw}` : line;
    }).join('\n');

    return `SECTION: ${sec}\n${rows}`;
  }).filter(Boolean).join('\n\n');
}

const DRAFTING_SYSTEM = `You are a Senior Chartered Party Wall Surveyor preparing a Schedule of Conditions under the Party Wall etc. Act 1996.

You are NOT transcribing or editing the surveyor's words. You are interpreting rough field notes and structured factual claims, then writing professional Schedule of Conditions observations from first principles.

EVIDENCE:
- The structured claim fields (element, construction, finish, condition, defect_type, location, direction, measurement, etc.) are the factual authority.
- The raw_fragment shows what the surveyor said. Use it for context only — do not copy it.
- Do NOT copy phrasing from raw_fragment. Write your own professional sentences.
- Only use active (non-superseded) claims. Never include superseded wording.

WRITING STANDARDS:
1. Complete grammatical sentences. Past tense (appeared, was noted, were observed, was tested).
2. Identify the element clearly in every sentence ("The party wall...", "The ceiling...").
3. Use correct Party Wall / building surveying terminology.
4. Preserve EVERY measurement, direction and location exactly as given in the structured fields.
5. One row per distinct element or defect. Combine construction + finish + general_condition of the SAME element into one row.
6. Keep specific defects as separate rows from general condition.
7. Remove all navigation language, conversational phrases and repetition.
8. NEVER write "good condition" or "very good condition" — use "no visible defects noted at the time of inspection".
9. No unsupported causation. No invented measurements. No vague expressions ("appears fine", "looks okay").
10. Window/door operational tests: name the element, state what was tested, state the result explicitly.
11. Water ingress: note whether area appears dry at time of inspection and state if remote from notifiable works.
12. Access limitations: state what restricts access and which elements were accessible.
13. Crack descriptions: state crack type, location, direction and measurement in a single clear sentence.
14. NEVER use "intermittently" for the 500mm crack — that word was corrected by the surveyor. The active claim is a plain hairline crack.

Return valid JSON only. No markdown.`;

// ─── Stage 2: Professional drafting with claim-count-aware batching ────────────
export async function draftFromClaims(claims, projectMeta, apiKey, modelMode) {
  const resolvedMode = modelMode || (typeof process !== 'undefined' && process.env.SOC_DRAFT_MODEL) || 'gpt4o';
  const model  = resolvedMode === 'gpt55' ? 'gpt-5.5' : 'gpt-4o';
  const params = resolvedMode === 'gpt55'
    ? { max_completion_tokens: 16000, reasoning_effort: 'medium' }
    : { temperature: 0.1, max_tokens: 16000 };

  const boAddress    = projectMeta.bo_address    || 'Not provided';
  const aoAddress    = projectMeta.ao_address    || 'Not provided';
  const inspDate     = projectMeta.inspection_date || new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const proposedWorks = projectMeta.proposed_works || 'Not specified';

  // Group active claims by section
  const sectionOrder = [], claimsBySection = {};
  for (const c of claims.filter(cl => cl.status === 'active')) {
    const sec = c.section || 'Unallocated';
    if (!claimsBySection[sec]) { claimsBySection[sec] = []; sectionOrder.push(sec); }
    claimsBySection[sec].push(c);
  }
  const uniqueSections = [...new Set(sectionOrder)];

  // Build claim-count-aware batches (max 25 active claims per batch)
  const batches = [];
  let currentBatch = [], currentCount = 0;

  for (const sec of uniqueSections) {
    const secClaims = claimsBySection[sec] || [];
    if (secClaims.length > MAX_CLAIMS_PER_BATCH) {
      if (currentBatch.length) { batches.push(currentBatch); currentBatch = []; currentCount = 0; }
      for (let j = 0; j < secClaims.length; j += MAX_CLAIMS_PER_BATCH) {
        const partNum = Math.floor(j / MAX_CLAIMS_PER_BATCH) + 1;
        const pseudoSec = partNum === 1 ? sec : `${sec} (Part ${partNum})`;
        batches.push([pseudoSec]);
        claimsBySection[pseudoSec] = secClaims.slice(j, j + MAX_CLAIMS_PER_BATCH);
      }
    } else if (currentCount + secClaims.length > MAX_CLAIMS_PER_BATCH && currentBatch.length) {
      batches.push(currentBatch); currentBatch = [sec]; currentCount = secClaims.length;
    } else {
      currentBatch.push(sec); currentCount += secClaims.length;
    }
  }
  if (currentBatch.length) batches.push(currentBatch);

  const allSections = [], allUnresolved = [], allAwardNotes = [], allGeneralNotes = [];
  let sectionNumber = 1;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batchSections = batches[batchIdx];
    const claimInput = buildDraftInput(batchSections, claimsBySection);
    const claimCount = batchSections.reduce((s, sec) => s + (claimsBySection[sec] || []).length, 0);
    console.log(`[soc-pipeline] Drafting batch ${batchIdx + 1}/${batches.length}: ${batchSections.join(', ')} (${claimCount} claims) model=${model}`);

    const userPrompt = `SECTIONS TO DRAFT (starting at section number ${sectionNumber}):
${claimInput}

PROPERTY: Adjoining Owner: ${aoAddress} | Building Owner: ${boAddress} | Date: ${inspDate} | Proposed Works: ${proposedWorks}

For each section, draft professional SOC rows. Each row must:
- Have a unique ref like "XX01"
- Identify the element clearly
- Preserve all measurements, locations and directions from the structured fields
- Be written from first principles — not copied from raw_fragment
- Group construction + finish + general_condition of the same element into one row where appropriate

Return JSON only:
{
  "sections": [
    {
      "number": N,
      "title": "exact section name from input",
      "rows": [
        {
          "ref": "XX01",
          "row_id": "unique-id",
          "element": "party wall",
          "observation": "The party wall had a plastered and painted finish and appeared free from visible defects at the time of inspection.",
          "action": "Record only",
          "source_note_ids": [1, 2],
          "source_claim_ids": ["c-1-1", "c-1-2"]
        }
      ]
    }
  ],
  "unresolved_notes": [],
  "award_notes": [],
  "general_notes": []
}`;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, ...params, messages: [
          { role: 'system', content: DRAFTING_SYSTEM },
          { role: 'user', content: userPrompt },
        ]}),
      });
      if (!res.ok) throw new Error(`Drafting API ${res.status}`);
      const d = await res.json();
      const raw = (d.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
      const batchResult = JSON.parse(raw);

      for (const sec of (batchResult.sections || [])) {
        sec.number = sectionNumber++;
        for (const row of (sec.rows || []))
          if (!row.row_id) row.row_id = `row-${sec.number}-${row.ref}-${Date.now()}`;
        allSections.push(sec);
      }
      for (const n of (batchResult.unresolved_notes || [])) {
        const text = typeof n === 'string' ? n : (n.note_text || n.text || n.note || JSON.stringify(n));
        if (text && !text.includes('{')) allGeneralNotes.push(text);
      }
      allAwardNotes.push(...(batchResult.award_notes || []));
      for (const n of (batchResult.general_notes || [])) {
        const text = typeof n === 'string' ? n : (n.note || n.text || n.description || '');
        if (text) allGeneralNotes.push(text);
      }
    } catch (e) {
      console.warn(`[soc-pipeline] Drafting batch ${batchIdx + 1} failed:`, e.message);
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

// ─── Stage 3: Quality audit (batched, async-only — not in sync pipeline) ───────
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
        body: JSON.stringify({ model: 'gpt-4o', temperature: 0.1, max_tokens: 3000,
          messages: [
            { role: 'system', content: 'Return valid JSON only.' },
            { role: 'user', content: `Review observations. Auto-fix only: speech-to-text residue, poor grammar, vague wording. Flag factual issues without changing them.\nReturn: { "rows": [{ "ref": "...", "observation": "...", "flagged": false, "flag_reason": null }] }\nROWS: ${JSON.stringify(batch)}` },
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
      if (c) { if (c.observation) r.observation = c.observation; if (c.flagged) { r.flagged = true; r.flag_reason = c.flag_reason; } }
    }
  return improved;
}

// ─── Completeness audit (coded, synchronous) ──────────────────────────────────
export function runCompletenessAudit(draftedResult, claims) {
  const claimIdsInRows = new Set();
  for (const s of (draftedResult.sections || []))
    for (const r of (s.rows || []))
      for (const cid of (r.source_claim_ids || [])) claimIdsInRows.add(cid);

  const contextualTypes = new Set(['contextual', 'site_note', 'section_transition', 'award_note']);
  const activeClaims = (claims || []).filter(c => c.status === 'active');
  const missing = activeClaims.filter(c => !claimIdsInRows.has(c.claim_id));
  const substantiveMissing = missing.filter(c => !contextualTypes.has(c.claim_type));

  const coverage = activeClaims.length > 0
    ? (((activeClaims.length - substantiveMissing.length) / activeClaims.length) * 100).toFixed(1)
    : '100.0';

  return {
    issues: substantiveMissing.map(c => `MISSING: ${c.claim_id} type=${c.claim_type} section="${c.section}" ${(c.defect_type || c.condition || '').slice(0, 60)}`),
    warnings: missing.filter(c => contextualTypes.has(c.claim_type)).map(c => `Contextual not in rows: ${c.claim_id}`),
    active_claims: activeClaims.length,
    missing_substantive: substantiveMissing.length,
    coverage_percent: coverage,
  };
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
