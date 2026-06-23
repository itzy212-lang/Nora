// api/lib/soc-pipeline.js
// Shared SOC pipeline functions imported by process-soc-note.js,
// generate-soc.js and soc-regression-test.js.
// Do NOT duplicate logic across those files — import from here instead.

// ─── Section batching constants ────────────────────────────────────────────
export const CLAIM_BATCH_NOTES  = 20;  // notes per claim-extraction batch
export const DRAFT_SECTION_BATCH = 5;  // sections per drafting batch
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
// ─── Model configurations for professional drafting ───────────────────────
const DRAFTING_MODELS = {
  gpt4o: {
    model: 'gpt-4o',
    params: { temperature: 0.1, max_tokens: 8000 },
    api: 'chat_completions',
  },
  gpt55: {
    model: 'gpt-5.5',
    params: { max_completion_tokens: 8000, reasoning_effort: 'medium' },
    api: 'chat_completions',
    // temperature REMOVED — unsupported on gpt-5.5 reasoning models
    // max_tokens REMOVED — replaced by max_completion_tokens
  },
};

// Call the OpenAI Chat Completions API with model-appropriate parameters
async function callDraftingAPI(messages, modelKey, apiKey) {
  const config = DRAFTING_MODELS[modelKey] || DRAFTING_MODELS.gpt4o;
  const started = Date.now();

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      ...config.params,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Drafting API error ${res.status} (model=${config.model}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const latency_ms = Date.now() - started;
  const usage = data.usage || {};

  return {
    content: (data.choices?.[0]?.message?.content || '').replace(/^```(?:json)?[\n]?/m, '').replace(/[\n]?```$/m, '').trim(),
    model_used: config.model,
    model_key: modelKey,
    latency_ms,
    input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
    output_tokens: usage.completion_tokens || usage.output_tokens || 0,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens || 0,
  };
}

// Build the structured claim summary for the drafting prompt.
// Claims are presented as structured FACTS + raw fragments — NOT as polished prose.
// This prevents the model from simply copying the claim content.
function buildClaimsSummary(sections, claimsBySection) {
  return sections.map(sec =>
    `SECTION: ${sec}
` +
    (claimsBySection[sec] || [])
      .filter(cl => cl.status === 'active' || cl.status === 'amendment_applied')
      .map(cl => {
        const parts = [
          `  [${cl.claim_id}] ${cl.claim_type}`,
          cl.element    ? `element: ${cl.element}` : null,
          cl.location   ? `location: ${cl.location}` : null,
        ].filter(Boolean).join(' | ');
        // Structured fact fields (if present — from newer claim format)
        const facts = [
          cl.construction ? `construction: ${cl.construction}` : null,
          cl.finish       ? `finish: ${cl.finish}` : null,
          cl.condition    ? `condition: ${cl.condition}` : null,
          cl.defect_type  ? `defect: ${cl.defect_type}` : null,
          cl.measurement  ? `measurement: ${cl.measurement}` : null,
          cl.direction    ? `direction: ${cl.direction}` : null,
        ].filter(Boolean).join(', ');
        // Fall back to content if no structured fields
        const factLine = facts || cl.content || '';
        const rawLine = cl.raw_fragment ? `    raw: "${cl.raw_fragment}"` : '';
        return `${parts}\n    facts: ${factLine}${rawLine ? '\n' + rawLine : ''}`;
      })
      .join('\n')
  ).join('\n\n');
}






// ─── Stage 2: Professional drafting with section batching ──────────────────
// modelMode: 'gpt4o' | 'gpt55' | 'compare'
// Returns { result, metadata } where metadata includes model, latency, tokens
export async function draftFromClaims(claims, projectMeta, apiKey, modelMode) {
  const resolvedMode = modelMode || (typeof process !== 'undefined' && process.env.SOC_DRAFT_MODEL) || 'gpt4o';
  const boAddress    = projectMeta.bo_address    || 'Not provided';
  const aoAddress    = projectMeta.ao_address    || 'Not provided';
  const inspDate     = projectMeta.inspection_date
    || new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const proposedWorks = projectMeta.proposed_works || 'Not specified';

  // Group claims by section
  const sectionOrder = [];
  const claimsBySection = {};
  for (const cl of claims) {
    const sec = cl.section || 'Unallocated';
    if (!claimsBySection[sec]) { claimsBySection[sec] = []; sectionOrder.push(sec); }
    claimsBySection[sec].push(cl);
  }
  const uniqueSections = [...new Set(sectionOrder)];

  // Compare mode: run both models and return both results
  if (resolvedMode === 'compare') {
    const [gpt4oResult, gpt55Result] = await Promise.all([
      _runDraftingBatches(uniqueSections, claimsBySection, boAddress, aoAddress, inspDate, proposedWorks, 'gpt4o', apiKey),
      _runDraftingBatches(uniqueSections, claimsBySection, boAddress, aoAddress, inspDate, proposedWorks, 'gpt55', apiKey),
    ]);
    return {
      ...gpt4oResult.result,
      _comparison: {
        gpt4o: gpt4oResult,
        gpt55: gpt55Result,
      },
      _model_mode: 'compare',
      _drafting_metadata: gpt4oResult.metadata,
    };
  }

  const { result, metadata } = await _runDraftingBatches(
    uniqueSections, claimsBySection, boAddress, aoAddress, inspDate, proposedWorks, resolvedMode, apiKey
  );
  return { ...result, _drafting_metadata: metadata };
}

async function _runDraftingBatches(uniqueSections, claimsBySection, boAddress, aoAddress, inspDate, proposedWorks, modelKey, apiKey) {
  const allSections = [], allUnresolved = [], allAwardNotes = [], allGeneralNotes = [];
  let sectionNumber = 1;
  const batchMetas = [];

  for (let i = 0; i < uniqueSections.length; i += DRAFT_SECTION_BATCH) {
    const batchSections = uniqueSections.slice(i, i + DRAFT_SECTION_BATCH);
    const batchNum = Math.floor(i / DRAFT_SECTION_BATCH) + 1;
    const totalBatches = Math.ceil(uniqueSections.length / DRAFT_SECTION_BATCH);
    console.log(`[soc-pipeline] Drafting batch ${batchNum}/${totalBatches} model=${modelKey}: ${batchSections.join(', ')}`);

    const claimsSummary = buildClaimsSummary(batchSections, claimsBySection);
    const startNum = sectionNumber;

    const systemPrompt = `You are a Senior Chartered Party Wall Surveyor preparing a Schedule of Conditions report under the Party Wall etc. Act 1996, prepared by Square One Consulting.

You are NOT transcribing or lightly editing the surveyor's wording. You are interpreting the reconciled factual record and writing a professional Schedule of Conditions observation from first principles.

Use the structured claims as the factual authority. Use the raw dictation fragments only for context.
Preserve every supported fact, but do not preserve the surveyor's grammar, sentence structure or phrasing.
The final wording must read as though it was written by an experienced Party Wall Surveyor from rough field notes.

WRITING STANDARD:
- Complete sentences. Past tense for condition observations (appeared, was noted, were observed).
- Correct surveying terminology. Identify every element clearly.
- Preserve construction, finish, condition, location, direction and measurement exactly.
- Distinguish general condition from specific defects. Keep separate defects as separate rows.
- No vague expressions. No unsupported causation. No invented facts.
- "No visible defects" must name the element and time of inspection.
- Window/door test rows must state what was tested and the result.
- Water staining must note whether dry at time of inspection.

Return valid JSON only. No markdown. No commentary.`;

    const userPrompt = `SECTIONS TO DRAFT (starting at number ${startNum}):
${claimsSummary}

PROPERTY: Building Owner: ${boAddress} | Adjoining Owner: ${aoAddress} | Date: ${inspDate} | Works: ${proposedWorks}

Return JSON:
{
  "sections": [{ "number": N, "title": "...", "rows": [{ "ref": "XX01", "row_id": "uuid", "element": "...", "observation": "Professional wording.", "action": "Record only", "source_note_ids": [], "source_claim_ids": ["c-1-1"] }] }],
  "unresolved_notes": [],
  "award_notes": [],
  "general_notes": []
}`;

    const { content, model_used, latency_ms, input_tokens, output_tokens, reasoning_tokens } =
      await callDraftingAPI(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        modelKey, apiKey
      );

    batchMetas.push({ batch: batchNum, model_used, latency_ms, input_tokens, output_tokens, reasoning_tokens });

    let batchResult;
    try { batchResult = JSON.parse(content); } catch { throw new Error(`Drafting returned invalid JSON in batch ${batchNum} (model=${modelKey})`); }

    for (const sec of (batchResult.sections || [])) {
      sec.number = sectionNumber++;
      for (const row of (sec.rows || []))
        if (!row.row_id) row.row_id = `row-${sec.number}-${row.ref}-${Date.now()}`;
      allSections.push(sec);
    }
    allUnresolved.push(...(batchResult.unresolved_notes || []));
    allAwardNotes.push(...(batchResult.award_notes || []));
    allGeneralNotes.push(...(batchResult.general_notes || []));
  }

  const totalMeta = {
    drafting_model: batchMetas[0]?.model_used || modelKey,
    model_key: modelKey,
    drafting_api: 'chat_completions',
    prompt_version: 'v2-structured-facts',
    total_latency_ms: batchMetas.reduce((s, m) => s + m.latency_ms, 0),
    total_input_tokens: batchMetas.reduce((s, m) => s + m.input_tokens, 0),
    total_output_tokens: batchMetas.reduce((s, m) => s + m.output_tokens, 0),
    total_reasoning_tokens: batchMetas.reduce((s, m) => s + m.reasoning_tokens, 0),
    batches: batchMetas,
    fallback_used: false,
  };

  return {
    result: { sections: allSections, unresolved_notes: allUnresolved, award_notes: allAwardNotes, general_notes: allGeneralNotes },
    metadata: totalMeta,
  };
}


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
