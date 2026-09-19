// api/lib/soc-brain-v2/fidelity-audit.js
//
// Nora SOC v2, Phase D4 — the Fidelity Audit orchestration.
//
// Consumes D3's draft() output directly — never re-drafts, never
// re-reconciles, never re-derives section assignment. A modular stage
// insertable after D3: runFidelityAudit() takes a draft result and
// returns findings; nothing here writes to any table or mutates the
// draft it's given (repair produces a NEW draft object).
//
// Per the governing specification (§19): deterministic checks run in
// code as a safety net, not as the audit itself. The genuinely
// semantic questions (does a paraphrase faithfully represent the
// evidence, did synthesis change meaning, was diagnosis introduced,
// was a spatial relationship lost) are the AI's job
// (fidelity-audit-contract.js), called once per section, matching
// D3's own per-section granularity and section-isolation guarantee.
//
// Rows are referenced positionally (section_id + index within that
// section) rather than requiring D3 to persist a new row id field -
// deliberately avoids any further change to D3's output schema.

import { assembleCanonicalGenerationInput } from './generation-input.js';
import { FIDELITY_AUDIT_CONTRACT } from './fidelity-audit-contract.js';
import { UNIVERSAL_SOC_BRAIN_V2 } from './universal-soc-brain.js';

function rowRef(sectionId, index) {
  return `${sectionId}#row${index + 1}`;
}

// ─── Deterministic checks (code, no model) — a safety net, not the audit itself ───

/**
 * Every draftable item must be cited by at least one row somewhere
 * (omission, by ID); every cited id must correspond to a real item
 * that actually existed (an invented/hallucinated citation).
 */
function checkCompleteness(draftResult) {
  const findings = [];
  const allItemIds = new Set(draftResult.reconciliation_items.map(i => i.id));
  const draftableIds = new Set(draftResult.reconciliation_items.filter(i => i.draftable).map(i => i.id));
  const citedIds = new Set();

  for (const section of draftResult.sections) {
    for (const row of section.rows) {
      for (const id of (row.source_item_ids || [])) citedIds.add(id);
    }
  }

  for (const id of draftableIds) {
    if (!citedIds.has(id)) {
      const item = draftResult.reconciliation_items.find(i => i.id === id);
      findings.push({
        severity: 'blocking', type: 'omitted_evidence',
        section_id: item?.section_id, section_name: item?.section_name,
        draft_row_id: null, source_item_ids: [id], draft_text: null,
        evidence_summary: item?.resolved_content || '',
        required_action: `Represent this evidence somewhere in the draft: "${item?.resolved_content}".`,
        auto_repairable: false, proposed_repair: null, _source: 'deterministic',
      });
    }
  }

  for (const section of draftResult.sections) {
    for (let i = 0; i < section.rows.length; i++) {
      for (const id of (section.rows[i].source_item_ids || [])) {
        if (!allItemIds.has(id)) {
          findings.push({
            severity: 'blocking', type: 'invented_fact',
            section_id: section.section_id, section_name: section.section_name,
            draft_row_id: rowRef(section.section_id, i), source_item_ids: [id],
            draft_text: section.rows[i].observation,
            evidence_summary: 'No such reconciled evidence item exists.',
            required_action: 'This row cites evidence that does not exist — remove or correct the citation.',
            auto_repairable: false, proposed_repair: null, _source: 'deterministic',
          });
        }
      }
    }
  }
  return findings;
}

/** A superseded item must never be cited by any drafted row. */
function checkSupersededResurrection(draftResult) {
  const findings = [];
  const superseded = new Map(draftResult.reconciliation_items.filter(i => i.status === 'superseded').map(i => [i.id, i]));
  for (const section of draftResult.sections) {
    for (let i = 0; i < section.rows.length; i++) {
      for (const id of (section.rows[i].source_item_ids || [])) {
        const item = superseded.get(id);
        if (item) {
          findings.push({
            severity: 'blocking', type: 'superseded_fact_resurrected',
            section_id: section.section_id, section_name: section.section_name,
            draft_row_id: rowRef(section.section_id, i), source_item_ids: [id],
            draft_text: section.rows[i].observation,
            evidence_summary: `This fact was superseded (superseded_by: ${item.superseded_by}) and must not appear as active: "${item.resolved_content}".`,
            required_action: 'Remove the superseded fact from this row; only its active replacement should be represented.',
            auto_repairable: false, proposed_repair: null, _source: 'deterministic',
          });
        }
      }
    }
  }
  return findings;
}

/**
 * Compares the drafted section order against the authoritative
 * first-visit order (Inspection State Contract, D1/D2) — never
 * floor hierarchy, never re-derived from the draft itself.
 */
function checkSectionOrder(draftResult, authoritativeSections) {
  const authoritativeOrder = [...authoritativeSections]
    .sort((a, b) => a.first_entered_sequence - b.first_entered_sequence)
    .map(s => s.id);
  const draftedOrder = draftResult.sections.map(s => s.section_id);
  const draftedRelevant = draftedOrder.filter(id => authoritativeOrder.includes(id));
  const authoritativeRelevant = authoritativeOrder.filter(id => draftedOrder.includes(id));

  if (JSON.stringify(draftedRelevant) !== JSON.stringify(authoritativeRelevant)) {
    return [{
      severity: 'blocking', type: 'section_order_violation',
      section_id: null, section_name: null, draft_row_id: null, source_item_ids: [],
      draft_text: null,
      evidence_summary: `Authoritative first-visit order: ${authoritativeRelevant.join(' -> ')}. Drafted order: ${draftedRelevant.join(' -> ')}.`,
      required_action: 'Reorder sections to match first-visit order, not floor hierarchy or any other ordering.',
      auto_repairable: false, proposed_repair: null, _source: 'deterministic',
    }];
  }
  return [];
}

/**
 * Safety-net only (per governing spec §19 — not a substitute for the
 * AI's semantic measurement check): extracts number+unit patterns from
 * each cited item's resolved content and confirms the same pattern
 * appears somewhere in the row(s) citing it. Generic pattern matching,
 * not tied to any specific value.
 */
function checkProtectedMeasurementsPresent(draftResult) {
  const findings = [];
  const numberUnitPattern = /\d+(?:\.\d+)?\s*(?:mm|millimetres?|millimeters?|cm|centimetres?|centimeters?|m|metres?|meters?)\b/gi;
  const itemsById = new Map(draftResult.reconciliation_items.map(i => [i.id, i]));

  for (const section of draftResult.sections) {
    for (let i = 0; i < section.rows.length; i++) {
      const row = section.rows[i];
      const rowText = (row.observation || '').toLowerCase();
      for (const id of (row.source_item_ids || [])) {
        const item = itemsById.get(id);
        if (!item || !item.draftable) continue;
        const sourceMatches = (item.resolved_content || '').match(numberUnitPattern) || [];
        for (const measurement of sourceMatches) {
          const numPart = measurement.match(/[\d.]+/)[0];
          const rowNormalised = rowText.replace(/\s+/g, '');
          if (!rowNormalised.includes(numPart)) {
            findings.push({
              severity: 'blocking', type: 'altered_measurement',
              section_id: section.section_id, section_name: section.section_name,
              draft_row_id: rowRef(section.section_id, i), source_item_ids: [id],
              draft_text: row.observation,
              evidence_summary: `Source evidence includes the measurement "${measurement}", not found in the drafted text citing it.`,
              required_action: `Confirm the measurement "${measurement}" is preserved, or explain its absence.`,
              auto_repairable: false, proposed_repair: null, _source: 'deterministic',
            });
          }
        }
      }
    }
  }
  return findings;
}

/**
 * Wrong section, checked deterministically: every cited item's OWN
 * section_id (set by Phase C / D1, never re-derived here) must match
 * the section whose rows cite it. A mention of another room as
 * spatial context is not a transition and never appears as a
 * mismatch here, because that was already resolved correctly at the
 * state layer — this only catches an item genuinely appearing under
 * the wrong section in the draft.
 */
function checkSectionAssignment(draftResult) {
  const findings = [];
  const itemsById = new Map(draftResult.reconciliation_items.map(i => [i.id, i]));
  for (const section of draftResult.sections) {
    for (let i = 0; i < section.rows.length; i++) {
      for (const id of (section.rows[i].source_item_ids || [])) {
        const item = itemsById.get(id);
        if (item && item.section_id && item.section_id !== section.section_id) {
          findings.push({
            severity: 'blocking', type: 'wrong_section',
            section_id: section.section_id, section_name: section.section_name,
            draft_row_id: rowRef(section.section_id, i), source_item_ids: [id],
            draft_text: section.rows[i].observation,
            evidence_summary: `This evidence belongs to "${item.section_name}", not "${section.section_name}".`,
            required_action: `Move this observation to its correct section: "${item.section_name}".`,
            auto_repairable: false, proposed_repair: null, _source: 'deterministic',
          });
        }
      }
    }
  }
  return findings;
}

/**
 * An item cited by more than one row is flagged for review — not
 * automatically blocking, since a rare legitimate case is
 * conceivable, but the governing instructions explicitly ask for this
 * to be checked deterministically rather than left to chance.
 */
function checkDuplicateSourceConsumption(draftResult) {
  const findings = [];
  const citationCount = new Map();
  const citationLocations = new Map();
  for (const section of draftResult.sections) {
    for (let i = 0; i < section.rows.length; i++) {
      for (const id of (section.rows[i].source_item_ids || [])) {
        citationCount.set(id, (citationCount.get(id) || 0) + 1);
        if (!citationLocations.has(id)) citationLocations.set(id, []);
        citationLocations.get(id).push({ section, index: i });
      }
    }
  }
  const itemsById = new Map(draftResult.reconciliation_items.map(i => [i.id, i]));
  for (const [id, count] of citationCount.entries()) {
    if (count > 1) {
      const locations = citationLocations.get(id);
      const item = itemsById.get(id);
      findings.push({
        severity: 'material', type: 'duplicated_observation',
        section_id: locations[0].section.section_id, section_name: locations[0].section.section_name,
        draft_row_id: locations.map(l => rowRef(l.section.section_id, l.index)).join(', '),
        source_item_ids: [id],
        draft_text: locations.map(l => l.section.rows[l.index].observation).join(' | '),
        evidence_summary: `Evidence "${item?.resolved_content}" is cited by ${count} separate rows.`,
        required_action: 'Confirm this is not the same evidence represented twice without justification.',
        auto_repairable: false, proposed_repair: null, _source: 'deterministic',
      });
    }
  }
  return findings;
}

function runDeterministicChecks(draftResult, authoritativeSections) {
  return [
    ...checkCompleteness(draftResult),
    ...checkSupersededResurrection(draftResult),
    ...checkSectionOrder(draftResult, authoritativeSections),
    ...checkProtectedMeasurementsPresent(draftResult),
    ...checkSectionAssignment(draftResult),
    ...checkDuplicateSourceConsumption(draftResult),
  ];
}

// ─── AI semantic audit (per section, matching D3's own isolation) ───

async function callAuditModel({ apiKey, systemContent, userPrompt, primaryModel = 'gpt-5.6-terra', fallbackModel = 'gpt-4o' }) {
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
    if (!res.ok) throw new Error(`Fidelity audit model call failed (${model}): ${res.status}`);
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

async function auditSection({ apiKey, model, section, sectionItems }) {
  const draftedRowsText = section.rows.map((r, i) => `[${rowRef(section.section_id, i)}] ${r.observation} (cites: ${(r.source_item_ids || []).join(', ') || 'none'})`).join('\n');
  const evidenceText = sectionItems.map(item => {
    const raw = item.raw_provenance?.map(p => p.raw_fragment).filter(Boolean).join(' | ') || '';
    return `- [${item.id}] status=${item.status} disposition=${item.disposition} content="${item.resolved_content}" raw="${raw}"`;
  }).join('\n');

  const userPrompt = [
    `SECTION: ${section.section_name}`,
    `DRAFTED ROWS:\n${draftedRowsText || '(no rows drafted for this section)'}`,
    `RECONCILED EVIDENCE (active, superseded, and unresolved — for checking omission, resurrection, and false resolution):\n${evidenceText}`,
  ].join('\n\n');

  const result = await callAuditModel({
    apiKey, model,
    systemContent: UNIVERSAL_SOC_BRAIN_V2 + '\n\n' + FIDELITY_AUDIT_CONTRACT,
    userPrompt,
  });

  return (result.findings || []).map(f => ({ ...f, section_id: section.section_id, section_name: section.section_name, _source: 'ai' }));
}

function summarise(findings) {
  const blocking_count = findings.filter(f => f.severity === 'blocking').length;
  const material_count = findings.filter(f => f.severity === 'material').length;
  const minor_count = findings.filter(f => f.severity === 'minor').length;
  return {
    status: blocking_count > 0 || material_count > 0 ? 'fail' : 'pass',
    blocking_count, material_count, minor_count,
    findings,
  };
}

/**
 * Full D4 Fidelity Audit. Read-only — never mutates the draft it's
 * given or any table. Runs deterministic checks against the whole
 * draft, then one AI semantic audit call per section (mirroring D3's
 * section isolation), merges everything into one report.
 */
export async function runFidelityAudit(supabase, { sessionId, projectId, aoId, draftResult, apiKey, model }) {
  const canonicalInput = await assembleCanonicalGenerationInput(supabase, { sessionId, projectId, aoId });
  const deterministicFindings = runDeterministicChecks(draftResult, canonicalInput.sections);

  const itemsBySection = new Map();
  for (const item of draftResult.reconciliation_items) {
    if (!itemsBySection.has(item.section_id)) itemsBySection.set(item.section_id, []);
    itemsBySection.get(item.section_id).push(item);
  }

  const aiFindings = [];
  for (const section of draftResult.sections) {
    const sectionItems = itemsBySection.get(section.section_id) || [];
    const found = await auditSection({ apiKey, model, section, sectionItems });
    aiFindings.push(...found);
  }

  return summarise([...deterministicFindings, ...aiFindings]);
}

/**
 * Applies only auto_repairable findings with a concrete proposed_repair
 * to a NEW copy of the draft — the original draftResult is never
 * mutated. Returns { repairedDraft, auditTrail } where auditTrail
 * records, per repair: the finding, the original row text, and the
 * resulting row text. Repairs never change source_item_ids — provenance
 * survives exactly as D3 established it.
 */
export function applyRepairs(draftResult, findings) {
  const repairable = findings.filter(f => f.auto_repairable && f.proposed_repair && f.draft_row_id);
  if (!repairable.length) return { repairedDraft: draftResult, auditTrail: [] };

  const repairsByRowRef = new Map(repairable.map(f => [f.draft_row_id, f]));
  const auditTrail = [];

  const repairedSections = draftResult.sections.map(section => ({
    ...section,
    rows: section.rows.map((row, i) => {
      const ref = rowRef(section.section_id, i);
      const finding = repairsByRowRef.get(ref);
      if (!finding) return row;
      auditTrail.push({
        draft_row_id: ref,
        finding: { type: finding.type, severity: finding.severity, evidence_summary: finding.evidence_summary },
        original_row: row.observation,
        repaired_row: finding.proposed_repair,
      });
      // source_item_ids deliberately unchanged - only the text is repaired.
      return { ...row, observation: finding.proposed_repair };
    }),
  }));

  return {
    repairedDraft: { ...draftResult, sections: repairedSections },
    auditTrail,
  };
}
