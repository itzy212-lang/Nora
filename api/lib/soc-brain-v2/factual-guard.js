// api/lib/soc-brain-v2/factual-guard.js
//
// Nora SOC v2, Phase D6 — the Post-Quality Factual Guard orchestration.
//
// Consumes D4's repaired draft and D5's output directly. Rows are
// matched exclusively by their stable row_id (never array position).
// Only rows whose wording D5 actually changed get any semantic
// attention at all — an unchanged row needs no model call to
// reconfirm what nobody touched (matches D5's own "leave a good row
// alone" discipline: D6 does the same for rows nobody rewrote).
//
// Fail-safe, throughout: equivalence must be actively confirmed to
// keep D5's wording. Anything else — a detected change, or genuine
// uncertainty — reverts to the D4 wording. D6 never invents a third
// version of a sentence; its only actions per row are accept D5,
// revert to D4, or (for a genuine structural anomaly) flag loudly.

import { FACTUAL_GUARD_CONTRACT } from './factual-guard-contract.js';
import { UNIVERSAL_SOC_BRAIN_V2 } from './universal-soc-brain.js';

const numberUnitPattern = /\d+(?:\.\d+)?\s*(?:mm|millimetres?|millimeters?|cm|centimetres?|centimeters?|m|metres?|meters?)\b/gi;

function extractMeasurements(text) {
  return ((text || '').match(numberUnitPattern) || []).map(m => m.match(/[\d.]+/)[0]);
}

function sameIds(a, b) {
  const sa = [...(a || [])].sort();
  const sb = [...(b || [])].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

function flattenRows(draft) {
  const map = new Map();
  for (const section of draft.sections) {
    for (const row of section.rows) {
      map.set(row.row_id, { ...row, section_id: section.section_id, section_name: section.section_name });
    }
  }
  return map;
}

/**
 * Deterministic checks, run for every row present in both drafts,
 * before any model call. A row that fails here never reaches the
 * semantic step — its finding is already conclusive.
 */
function runDeterministicChecks(d4Row, d5Row, blockedRowIds) {
  const findings = [];
  const isBlocked = blockedRowIds.has(d4Row.row_id);

  if (d4Row.section_id !== d5Row.section_id) {
    findings.push({ check: 'section_id', severity: 'blocking', passed: false, detail: `section_id changed: "${d4Row.section_id}" -> "${d5Row.section_id}"` });
  }
  if (!sameIds(d4Row.source_item_ids, d5Row.source_item_ids)) {
    findings.push({ check: 'source_item_ids', severity: 'blocking', passed: false, detail: `provenance changed: [${d4Row.source_item_ids}] -> [${d5Row.source_item_ids}]` });
  }

  const wordingChanged = d4Row.observation !== d5Row.observation;

  if (isBlocked && wordingChanged) {
    findings.push({ check: 'blocked_row_untouched', severity: 'blocking', passed: false, detail: 'A D4-blocked row was modified — it must remain byte-for-byte unchanged.' });
  }

  if (wordingChanged && findings.length === 0) {
    const d4Measurements = extractMeasurements(d4Row.observation);
    const d5Text = (d5Row.observation || '');
    for (const num of d4Measurements) {
      if (!d5Text.replace(/\s+/g, '').includes(num)) {
        findings.push({ check: 'protected_measurement', severity: 'blocking', passed: false, detail: `A measurement present in the D4 wording ("${num}") does not appear in the D5 wording.` });
      }
    }
  }

  return { findings, wordingChanged, isBlocked };
}

async function callGuardModel({ apiKey, systemContent, userPrompt, primaryModel = 'gpt-5.6-terra', fallbackModel = 'gpt-4o' }) {
  async function attempt(model) {
    const isTerra = model.startsWith('gpt-5.6');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        ...(isTerra ? { max_completion_tokens: 4000 } : { max_tokens: 4000, response_format: { type: 'json_object' } }),
        messages: [
          { role: isTerra ? 'developer' : 'system', content: systemContent },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Factual guard model call failed (${model}): ${res.status}`);
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || '')
      .replace(/^[`]{3}(?:json)?[\s]*/m, '').replace(/[\s]*[`]{3}$/m, '').trim();
    return JSON.parse(raw);
  }
  try {
    return await attempt(primaryModel);
  } catch (primaryErr) {
    if (primaryModel === fallbackModel) throw primaryErr;
    return await attempt(fallbackModel);
  }
}

async function checkSemanticEquivalence({ apiKey, model, pairs }) {
  if (!pairs.length) return new Map();
  const userPrompt = pairs.map(p => `[${p.row_id}]\nD4: "${p.d4}"\nD5: "${p.d5}"`).join('\n\n');
  const result = await callGuardModel({
    apiKey, model,
    systemContent: UNIVERSAL_SOC_BRAIN_V2 + '\n\n' + FACTUAL_GUARD_CONTRACT,
    userPrompt: `COMPARE EACH D4/D5 PAIR:\n\n${userPrompt}`,
  });
  const byRef = new Map();
  for (const r of (result.results || [])) byRef.set(r.reference, r);
  return byRef;
}

/**
 * Full D6 Post-Quality Factual Guard. Read-only with respect to any
 * table — operates entirely on the two draft objects it is given and
 * returns a new, final object; mutates neither input.
 */
export async function runPostQualityGuard(supabase, { sessionId, d4Draft, d5Draft, blockedRowIds = [], apiKey, model }) {
  const blocked = new Set(blockedRowIds);
  const d4Rows = flattenRows(d4Draft);
  const d5Rows = flattenRows(d5Draft);

  const guardFindings = [];
  const semanticPairs = [];
  const rowResults = new Map();

  const d4Ids = new Set(d4Rows.keys());
  const d5Ids = new Set(d5Rows.keys());
  const missingFromD5 = [...d4Ids].filter(id => !d5Ids.has(id));
  const extraInD5 = [...d5Ids].filter(id => !d4Ids.has(id));
  for (const id of missingFromD5) {
    guardFindings.push({ row_id: id, check: 'row_set_integrity', severity: 'blocking', detail: 'Row present in D4 output is missing from D5 output.' });
  }
  for (const id of extraInD5) {
    guardFindings.push({ row_id: id, check: 'row_set_integrity', severity: 'blocking', detail: 'Row present in D5 output has no corresponding D4 row — unexplained new row.' });
  }

  for (const [rowId, d4Row] of d4Rows.entries()) {
    const d5Row = d5Rows.get(rowId);
    if (!d5Row) {
      // Already recorded as a row_set_integrity finding above. The
      // row must not simply vanish from the final output - restore
      // the D4 wording so nothing is silently dropped, and make the
      // loss visible in the audit trail rather than crashing or
      // omitting the row entirely.
      rowResults.set(rowId, {
        finalObservation: d4Row.observation,
        action: 'REVERT_TO_D4',
        explanation: 'This row was missing from the D5 output entirely; restored from D4.',
        deterministic: [{ check: 'row_set_integrity', severity: 'blocking', passed: false, detail: 'Missing from D5 output.' }],
        semantic: null,
      });
      continue;
    }

    const { findings, wordingChanged, isBlocked } = runDeterministicChecks(d4Row, d5Row, blocked);
    guardFindings.push(...findings.map(f => ({ row_id: rowId, section_id: d4Row.section_id, ...f })));

    if (findings.length > 0) {
      rowResults.set(rowId, {
        finalObservation: d4Row.observation,
        action: 'REVERT_TO_D4',
        explanation: findings.map(f => f.detail).join(' '),
        deterministic: findings,
        semantic: null,
      });
      continue;
    }

    if (!wordingChanged) {
      rowResults.set(rowId, {
        finalObservation: d4Row.observation,
        action: 'PASSTHROUGH',
        explanation: isBlocked ? 'D4-blocked row, correctly untouched.' : 'D5 left this row unchanged.',
        deterministic: findings,
        semantic: null,
      });
      continue;
    }

    semanticPairs.push({ row_id: rowId, d4: d4Row.observation, d5: d5Row.observation });
  }

  const pairsBySection = new Map();
  for (const p of semanticPairs) {
    const sectionId = d4Rows.get(p.row_id).section_id;
    if (!pairsBySection.has(sectionId)) pairsBySection.set(sectionId, []);
    pairsBySection.get(sectionId).push(p);
  }

  for (const [, pairs] of pairsBySection.entries()) {
    const verdicts = await checkSemanticEquivalence({ apiKey, model, pairs });
    for (const p of pairs) {
      const d4Row = d4Rows.get(p.row_id);
      const d5Row = d5Rows.get(p.row_id);
      const verdict = verdicts.get(p.row_id);

      if (!verdict) {
        rowResults.set(p.row_id, {
          finalObservation: d4Row.observation,
          action: 'FLAG_UNCERTAIN',
          explanation: 'No guard verdict was returned for this row.',
          deterministic: [],
          semantic: { verdict: 'UNCERTAIN', explanation: 'No verdict returned.' },
        });
        continue;
      }

      if (verdict.verdict === 'FACTUALLY_EQUIVALENT') {
        rowResults.set(p.row_id, {
          finalObservation: d5Row.observation,
          action: 'ACCEPT_D5',
          explanation: verdict.explanation,
          deterministic: [],
          semantic: verdict,
        });
      } else if (verdict.verdict === 'FACTUAL_CHANGE') {
        rowResults.set(p.row_id, {
          finalObservation: d4Row.observation,
          action: 'REVERT_TO_D4',
          explanation: verdict.explanation,
          deterministic: [],
          semantic: verdict,
        });
      } else {
        rowResults.set(p.row_id, {
          finalObservation: d4Row.observation,
          action: 'FLAG_UNCERTAIN',
          explanation: verdict.explanation,
          deterministic: [],
          semantic: verdict,
        });
      }
    }
  }

  const d4SectionOrder = d4Draft.sections.map(s => s.section_id);
  const d5SectionOrder = d5Draft.sections.map(s => s.section_id);
  if (JSON.stringify(d4SectionOrder) !== JSON.stringify(d5SectionOrder)) {
    guardFindings.push({ row_id: null, section_id: null, check: 'section_order', severity: 'blocking', detail: `Section order changed: [${d4SectionOrder}] -> [${d5SectionOrder}]` });
  }

  const finalSections = d4Draft.sections.map(section => ({
    section_id: section.section_id,
    section_name: section.section_name,
    rows: section.rows.map(row => {
      const r = rowResults.get(row.row_id);
      return {
        row_id: row.row_id,
        observation: r.finalObservation,
        element: row.element,
        source_item_ids: row.source_item_ids,
      };
    }),
  }));

  const auditTrail = [...rowResults.entries()]
    .filter(([, r]) => r.action !== 'PASSTHROUGH')
    .map(([rowId, r]) => {
      const d4Row = d4Rows.get(rowId);
      const d5Row = d5Rows.get(rowId); // may be undefined if the row was missing from D5 entirely
      return {
        row_id: rowId,
        section_id: d4Row.section_id,
        source_item_ids: d4Row.source_item_ids,
        d4_wording: d4Row.observation,
        d5_wording: d5Row ? d5Row.observation : null,
        deterministic_result: r.deterministic,
        semantic_result: r.semantic,
        final_wording: r.finalObservation,
        action: r.action,
        explanation: r.explanation,
      };
    });

  const blockingFindingCount = guardFindings.filter(f => f.severity === 'blocking').length;
  const status = blockingFindingCount > 0 ? 'guard_findings_present' : 'pass';

  return {
    session_id: sessionId,
    sections: finalSections,
    guard_findings: guardFindings,
    audit_trail: auditTrail,
    status,
    blocked_row_ids: [...blocked],
  };
}
