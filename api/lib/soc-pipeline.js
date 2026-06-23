// api/lib/soc-pipeline.js
// Shared SOC pipeline functions imported by process-soc-note.js,
// generate-soc.js and soc-regression-test.js.
// Do NOT duplicate logic across those files — import from here instead.

// ─── Section batching constants ────────────────────────────────────────────
export const CLAIM_BATCH_NOTES  = 20;  // notes per claim-extraction batch
export const DRAFT_SECTION_BATCH = 3;  // sections per drafting batch
export const QUALITY_ROW_BATCH   = 15; // rows per quality-audit batch
export const FIDELITY_ROW_BATCH  = 10; // rows per semantic fidelity batch

// ─── Complexity detection for model escalation ────────────────────────────
export function noteComplexity(note, noteType, hasCorrection) {
  const words = note.split(/\s+/).length;
  const hasMeasurement = /\d+\s*(mm|cm|m\b|ft|inch)/i.test(note);
  const defectCount = (note.match(/crack|joint|defect|stain|spall|lift/gi) || []).length;
  const hasDirection = /(left|right|upper|lower|corner|diagonal|vertical|horizontal)/i.test(note);
  if (noteType === 'amendment' || hasCorrection) return 'high';
  if (words > 50 || (hasMeasurement && defectCount > 1) || (defectCount > 1 && hasDirection)) return 'high';
  if (words > 25 || hasMeasurement) return 'medium';
  return 'low';
}

export function modelForComplexity(complexity) {
  return complexity === 'high' ? 'gpt-4o' : 'gpt-4o-mini';
}

// ─── Stage 1: Claim extraction with batching ───────────────────────────────
export async function extractAtomicClaims(rawNotes, apiKey) {
  const lines = rawNotes.split(/\n+/).filter(l => l.trim());
  if (lines.length <= CLAIM_BATCH_NOTES) {
    return _extractClaimsBatch(rawNotes, null, apiKey);
  }
  let allClaims = [], currentSection = null;
  for (let i = 0; i < lines.length; i += CLAIM_BATCH_NOTES) {
    const batchText = lines.slice(i, i + CLAIM_BATCH_NOTES).join('\n');
    const batchNum = Math.floor(i / CLAIM_BATCH_NOTES) + 1;
    const totalBatches = Math.ceil(lines.length / CLAIM_BATCH_NOTES);
    console.log(`[soc-pipeline] Claim extraction batch ${batchNum}/${totalBatches}`);
    const batchClaims = await _extractClaimsBatch(batchText, currentSection, apiKey);
    const lastWithSection = [...batchClaims].reverse().find(c => c.section);
    if (lastWithSection) currentSection = lastWithSection.section;
    allClaims = allClaims.concat(batchClaims);
  }
  return allClaims;
}

async function _extractClaimsBatch(notes, carrySection, apiKey) {
  const sectionCtx = carrySection
    ? `CURRENT ACTIVE SECTION (carry forward): ${carrySection}\n\n`
    : '';
  const prompt = `${sectionCtx}Extract every atomic factual claim from these dictated site notes.
One note may contain many separate facts. Do not compress into one claim per note.

SECTION CARRY-FORWARD: Once established, section persists until explicit change or physical incompatibility.
AMENDMENTS: Where a note corrects earlier content, set status="superseded" on the original claim and create a corrected active claim with amendment_mode set.
The corrected 500mm crack must NOT say "intermittently" — the correction explicitly removed that word.

Return JSON only: { "claims": [{ "claim_id": "c-N-M", "source_note_id": N, "note_sequence": N, "claim_sequence": M, "claim_type": "section_declaration|construction_description|finish_description|general_condition|specific_defect|access_limitation|operational_test|contextual|amendment|site_note|award_note|unresolved", "section": "...", "element": "...", "location": "...", "content": "Clean English statement of the fact.", "confidence": "high|medium|low", "status": "active|superseded|contextual|unresolved", "superseded_by": null, "amendment_mode": null }] }

NOTES:
${notes}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.05,
      max_tokens: 6000,
      messages: [
        { role: 'system', content: 'Extract atomic claims. Return valid JSON only. No markdown.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Claim extraction API error ${res.status}`);
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content || '').replace(/```json\n?|\n?```/g, '').trim();
  try { return JSON.parse(raw).claims || []; } catch { return []; }
}

// ─── Stage 2: Professional drafting with section batching ──────────────────
export async function draftFromClaims(claims, projectMeta, apiKey) {
  const boAddress    = projectMeta.bo_address    || 'Not provided';
  const aoAddress    = projectMeta.ao_address    || 'Not provided';
  const inspDate     = projectMeta.inspection_date
    || new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const proposedWorks = projectMeta.proposed_works || 'Not specified';

  // Group claims by section, preserving order
  const sectionOrder = [];
  const claimsBySection = {};
  for (const c of claims) {
    const sec = c.section || 'Unallocated';
    if (!claimsBySection[sec]) { claimsBySection[sec] = []; sectionOrder.push(sec); }
    claimsBySection[sec].push(c);
  }
  const uniqueSections = [...new Set(sectionOrder)];

  // Draft in section batches
  const allSections = [];
  const allUnresolved = [];
  const allAwardNotes = [];
  const allGeneralNotes = [];
  let sectionNumber = 1;

  // Build claim-count-aware batches — cap at 25 claims per batch regardless of section count
  const MAX_CLAIMS_PER_BATCH = 25;
  const batches = [];
  let currentBatch = [], currentCount = 0;
  for (const sec of uniqueSections) {
    const secClaims = (claimsBySection[sec] || []).filter(cl => cl.status === 'active' || !cl.status);
    // Oversized single section: split by element groups
    if (secClaims.length > MAX_CLAIMS_PER_BATCH) {
      if (currentBatch.length) { batches.push(currentBatch); currentBatch = []; currentCount = 0; }
      // Chunk within the section by element
      for (let j = 0; j < secClaims.length; j += MAX_CLAIMS_PER_BATCH) {
        const chunk = secClaims.slice(j, j + MAX_CLAIMS_PER_BATCH);
        const partNum = Math.floor(j / MAX_CLAIMS_PER_BATCH) + 1;
        const pseudoSec = partNum === 1 ? sec : sec + ` (Part ${partNum})`;
        batches.push([pseudoSec]);
        // Store chunked claims under pseudo-section key
        claimsBySection[pseudoSec] = chunk;
      }
    } else if (currentCount + secClaims.length > MAX_CLAIMS_PER_BATCH && currentBatch.length) {
      batches.push(currentBatch); currentBatch = [sec]; currentCount = secClaims.length;
    } else {
      currentBatch.push(sec); currentCount += secClaims.length;
    }
  }
  if (currentBatch.length) batches.push(currentBatch);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batchSections = batches[batchIdx];
    const batchNum = batchIdx + 1;
    const totalBatches = batches.length;
    const claimCount = batchSections.reduce((s, sec) => s + (claimsBySection[sec] || []).length, 0);
    console.log(`[soc-pipeline] Drafting batch ${batchNum}/${totalBatches}: ${batchSections.join(', ')} (${claimCount} claims)`);

    const batchClaims = batchSections.flatMap(sec => claimsBySection[sec] || []);
    const claimsSummary = batchSections.map(sec =>
      `SECTION: ${sec}\n` +
      (claimsBySection[sec] || [])
        .map(c => `  [${c.claim_id}] ${c.claim_type} status=${c.status}${c.element ? ' element='+c.element : ''}${c.location ? ' location='+c.location : ''}\n  content: ${c.content}`)
        .join('\n')
    ).join('\n\n');

    const startNum = sectionNumber;
    const prompt = `You are a Senior Chartered Party Wall Surveyor writing a Schedule of Conditions.

CRITICAL: You are NOT transcribing. Write every observation from first principles.
Preserve every measurement, direction and location exactly as stated in claims.
Every active claim must appear. Group related claims (construction+finish+general_condition → one row). Keep separate defects as separate rows.
The 500mm crack correction must NOT contain "intermittently" — the surveyor explicitly removed that word.

SECTIONS TO DRAFT (starting at number ${startNum}):
${claimsSummary}

PROPERTY: Building Owner: ${boAddress} | Adjoining Owner: ${aoAddress} | Date: ${inspDate} | Works: ${proposedWorks}

Return JSON only: {
  "sections": [{ "number": N, "title": "...", "rows": [{ "ref": "XX01", "row_id": "stable-uuid", "element": "...", "observation": "Professional wording.", "action": "Record only", "source_note_ids": [1,2], "source_claim_ids": ["c-1-1"] }] }],
  "unresolved_notes": [{ "note_index": N, "note_text": "...", "suggested_section": "...", "reason": "..." }],
  "award_notes": [],
  "general_notes": []
}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.1,
        max_tokens: 16000,
        messages: [
          { role: 'system', content: 'Senior Party Wall Surveyor. Return valid JSON only. No markdown.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Drafting API error ${res.status}`);
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || '').replace(/```json\n?|\n?```/g, '').trim();
    let batchResult;
    try { batchResult = JSON.parse(raw); } catch { throw new Error('Drafting returned invalid JSON in batch ' + batchNum); }

    // Assign stable row IDs if missing, track section counter
    for (const sec of (batchResult.sections || [])) {
      sec.number = sectionNumber++;
      for (const row of (sec.rows || [])) {
        if (!row.row_id) row.row_id = `row-${sec.number}-${row.ref}-${Date.now()}`;
      }
      allSections.push(sec);
    }
    allUnresolved.push(...(batchResult.unresolved_notes || []));
    allAwardNotes.push(...(batchResult.award_notes || []));
    allGeneralNotes.push(...(batchResult.general_notes || []));
  }

  return {
    sections: allSections,
    unresolved_notes: allUnresolved,
    award_notes: allAwardNotes,
    general_notes: allGeneralNotes,
  };
}

// ─── Stage 3: Quality audit with batching ─────────────────────────────────
export async function runQualityAudit(draftedResult, apiKey) {
  const rows = [];
  for (const s of (draftedResult.sections || []))
    for (const r of (s.rows || []))
      if (r.observation) rows.push({ ref: r.ref, section: s.title, observation: r.observation });

  if (!rows.length) return draftedResult;
  const corrected = {};

  for (let i = 0; i < rows.length; i += QUALITY_ROW_BATCH) {
    const batch = rows.slice(i, i + QUALITY_ROW_BATCH);
    const prompt = `Review Schedule of Conditions observations. Auto-fix stylistic issues only. Flag factual issues without changing them.

AUTO-FIX: speech-to-text residue, poor grammar, missing articles/verbs, "good condition"→"no visible defects noted at the time of inspection", "very good condition"→same, vague language ("looks fine").
FLAG (flagged:true, preserve observation): over-compression of separate defects, unsupported diagnosis/causation, invented measurements.
NEVER remove or omit any claim content.

Return JSON only: { "rows": [{ "ref": "...", "observation": "...", "flagged": false, "flag_reason": null }] }

ROWS: ${JSON.stringify(batch)}`;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', temperature: 0.1, max_tokens: 3000,
          messages: [{ role: 'system', content: 'Return valid JSON only.' }, { role: 'user', content: prompt }] }),
      });
      const d = await res.json();
      const parsed = JSON.parse((d.choices?.[0]?.message?.content || '{}').replace(/```json\n?|\n?```/g, ''));
      for (const r of (parsed?.rows || [])) corrected[r.ref] = r;
    } catch (e) { console.warn('[soc-pipeline] Quality batch failed:', e.message); }
  }

  const improved = JSON.parse(JSON.stringify(draftedResult));
  for (const s of (improved.sections || []))
    for (const r of (s.rows || [])) {
      const c = corrected[r.ref];
      if (c) {
        if (c.observation) r.observation = c.observation;
        if (c.flagged) { r.flagged = true; r.flag_reason = c.flag_reason; }
      }
    }
  return improved;
}

// ─── Stage 4: Factual fidelity audit (coded + semantic GPT) ───────────────
export async function runFidelityAudit(draftedResult, claims, apiKey) {
  const claimMap = {};
  for (const c of (claims || [])) claimMap[c.claim_id] = c;

  const coded = _codedFidelityChecks(draftedResult, claimMap);
  const semantic = await _semanticFidelityChecks(draftedResult, claimMap, apiKey);
  return { issues: [...coded.issues, ...semantic.issues], warnings: [...coded.warnings, ...semantic.warnings] };
}

function _codedFidelityChecks(draftedResult, claimMap) {
  const issues = [], warnings = [];
  for (const s of (draftedResult.sections || []))
    for (const r of (s.rows || [])) {
      if (!r.source_claim_ids?.length) { warnings.push(`Row ${r.ref}: no source_claim_ids`); continue; }
      const obs = (r.observation || '').toLowerCase();
      for (const cid of r.source_claim_ids) {
        const c = claimMap[cid];
        if (!c) continue;
        if (c.status === 'superseded') warnings.push(`Row ${r.ref}: references superseded claim ${cid}`);
        const nums = (c.content || '').match(/\d+\s*mm/gi) || [];
        for (const n of nums)
          if (!obs.includes(n.toLowerCase().replace(/\s+/g, ''))) 
            issues.push(`Row ${r.ref}: measurement "${n}" from claim ${cid} not found in observation`);
      }
      if (/caused by|due to|structural movement|subsidence/i.test(r.observation || '')) {
        const srcs = r.source_claim_ids.map(id => claimMap[id]).filter(Boolean);
        if (!srcs.some(c => /caused|structural|movement/i.test(c?.content || '')))
          issues.push(`Row ${r.ref}: unsupported causation in observation`);
      }
    }
  return { issues, warnings };
}

async function _semanticFidelityChecks(draftedResult, claimMap, apiKey) {
  const rowsToCheck = [];
  for (const s of (draftedResult.sections || []))
    for (const r of (s.rows || [])) {
      const srcs = (r.source_claim_ids || []).map(id => claimMap[id]).filter(Boolean);
      if (srcs.some(c => /\d+(mm|m\b)/i.test(c?.content || '') || c?.claim_type === 'amendment'))
        rowsToCheck.push({ ref: r.ref, observation: r.observation,
          sources: srcs.map(c => ({ id: c.claim_id, content: c.content, status: c.status, type: c.claim_type })) });
    }

  if (!rowsToCheck.length) return { issues: [], warnings: [] };
  const allIssues = [], allWarnings = [];

  for (let i = 0; i < rowsToCheck.length; i += FIDELITY_ROW_BATCH) {
    const batch = rowsToCheck.slice(i, i + FIDELITY_ROW_BATCH);
    const prompt = `Audit observations against source claims for factual fidelity.
Check: measurements unchanged, directions preserved, locations preserved, amendments applied, no superseded wording, no unsupported conclusions.
Return JSON only: { "issues": ["Row XX: ..."], "warnings": ["Row XX: ..."] }
DATA: ${JSON.stringify(batch)}`;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', temperature: 0.05, max_tokens: 1500,
          messages: [{ role: 'system', content: 'Return valid JSON only.' }, { role: 'user', content: prompt }] }),
      });
      const d = await res.json();
      const parsed = JSON.parse((d.choices?.[0]?.message?.content || '{}').replace(/```json\n?|\n?```/g, ''));
      allIssues.push(...(parsed?.issues || []));
      allWarnings.push(...(parsed?.warnings || []));
    } catch (e) { console.warn('[soc-pipeline] Semantic fidelity batch failed:', e.message); }
  }
  return { issues: allIssues, warnings: allWarnings };
}

// ─── Completeness audit (claim-level) ─────────────────────────────────────
export function runCompletenessAudit(draftedResult, claims) {
  const issues = [], warnings = [];
  const claimIdsInRows = new Set();
  for (const s of (draftedResult.sections || []))
    for (const r of (s.rows || []))
      for (const cid of (r.source_claim_ids || [])) claimIdsInRows.add(cid);

  const contextualTypes = new Set(['contextual', 'site_note', 'section_declaration', 'award_note']);
  const activeClaims = (claims || []).filter(c => c.status === 'active');
  const missing = activeClaims.filter(c => !claimIdsInRows.has(c.claim_id));

  for (const c of missing) {
    if (contextualTypes.has(c.claim_type)) {
      warnings.push(`Claim ${c.claim_id} (${c.claim_type}) not in rows — verify contextual placement`);
    } else {
      issues.push(`MISSING: claim ${c.claim_id} type=${c.claim_type} section="${c.section}" content="${(c.content || '').slice(0, 80)}"`);
    }
  }

  const rate = activeClaims.length > 0
    ? ((activeClaims.length - missing.filter(c => !contextualTypes.has(c.claim_type)).length) / activeClaims.length * 100).toFixed(1)
    : '100.0';

  return { issues, warnings, active_claims: activeClaims.length, missing_substantive: missing.filter(c => !contextualTypes.has(c.claim_type)).length, coverage_percent: rate };
}
