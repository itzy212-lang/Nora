// api/lib/soc-brain-v2/quality-audit.js
//
// Nora SOC v2, Phase D5 — the Professional Quality Audit
// orchestration.
//
// Consumes a draft directly (the D4 fidelity-repaired output) —
// never re-drafts, never re-reconciles, never re-runs fidelity
// checks. Role separation from D4 is enforced structurally, not just
// by prompt instruction: any row identified by the caller as still
// carrying an unresolved blocking fidelity finding is excluded from
// what reaches the model at all (blockedRowIds) — D5 cannot "improve
// its way around" a block, because a blocked row is never shown to
// it in the first place.
//
// Runs one call per section, matching D3/D4's own isolation and
// evidence boundary. Edits are matched back to rows by their stable
// row_id (drafting.js) — never by array position — and only applied
// where source_item_ids and row_id are left completely untouched;
// only the observation text ever changes.

import { UNIVERSAL_SOC_BRAIN_V2 } from './universal-soc-brain.js';
import { USER_SOC_BRAIN_V2, buildUserSocBrainContext } from './user-soc-brain.js';
import { QUALITY_AUDIT_CONTRACT } from './quality-audit-contract.js';

/**
 * Terra, matching the exact established invocation pattern used by
 * D2/D3/D4 in this codebase - not a new pattern for this stage.
 * Falls back to gpt-4o on failure, same as the established precedent.
 * Phase C's own model is untouched by this or any other D-phase work.
 */
async function callQualityModel({ apiKey, systemContent, userPrompt, primaryModel = 'gpt-5.6-terra', fallbackModel = 'gpt-4o' }) {
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
    if (!res.ok) throw new Error(`Quality audit model call failed (${model}): ${res.status}`);
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

async function reviewSection({ apiKey, model, section, reviewableRows, userBrainContext }) {
  if (!reviewableRows.length) {
    return { status: 'pass', edits: [], issues_for_upstream_review: [] };
  }
  const rowsText = reviewableRows.map(r => `[${r.row_id}] ${r.observation}`).join('\n');
  const userPrompt = [
    `SECTION: ${section.section_name}`,
    `FACTUALLY VERIFIED ROWS (already cleared Fidelity Audit — facts are locked):\n${rowsText}`,
  ].join('\n\n');

  return callQualityModel({
    apiKey, model,
    systemContent: [UNIVERSAL_SOC_BRAIN_V2, QUALITY_AUDIT_CONTRACT, userBrainContext].filter(Boolean).join('\n\n'),
    userPrompt,
  });
}

/**
 * Full D5 Professional Quality Audit. Read-only with respect to any
 * table — operates entirely on the draftResult object it is given
 * and returns a NEW object; never mutates its input.
 *
 * blockedRowIds: row_ids the caller has determined still carry an
 * unresolved (not auto-repaired) blocking Fidelity Audit finding.
 * These rows are excluded from every section's prompt entirely and
 * pass through completely unchanged, each annotated
 * quality_reviewed: false so the omission is visible, not silent.
 */
export async function runQualityAudit(supabase, { sessionId, projectId, aoId, draftResult, blockedRowIds = [], apiKey, model, userBrain }) {
  const blocked = new Set(blockedRowIds);
  const userBrainContext = userBrain ? buildUserSocBrainContext(userBrain) : USER_SOC_BRAIN_V2;

  const sections = [];
  const auditTrail = [];
  const allIssuesForUpstreamReview = [];

  for (const section of draftResult.sections) {
    const reviewableRows = section.rows.filter(r => !blocked.has(r.row_id));

    const result = await reviewSection({ apiKey, model, section, reviewableRows, userBrainContext });

    const reviewableIds = new Set(reviewableRows.map(r => r.row_id));
    const editsByRowId = new Map(
      (result.edits || [])
        // Code-level validation: an edit may only apply to a row that
        // was genuinely offered to this call. A hallucinated or
        // cross-section reference cannot enter the output.
        .filter(e => reviewableIds.has(e.reference))
        .map(e => [e.reference, e])
    );

    const newRows = section.rows.map(row => {
      if (blocked.has(row.row_id)) {
        return { ...row, quality_reviewed: false, quality_skip_reason: 'unresolved fidelity block' };
      }
      const edit = editsByRowId.get(row.row_id);
      if (!edit || edit.revised === row.observation) {
        return { ...row, quality_reviewed: true };
      }
      auditTrail.push({
        row_id: row.row_id,
        section_id: section.section_id,
        original: row.observation,
        reason: edit.reason,
        revised: edit.revised,
      });
      // row_id, section membership, and source_item_ids are
      // deliberately untouched - only the observation text changes.
      return { ...row, observation: edit.revised, quality_reviewed: true };
    });

    for (const issue of (result.issues_for_upstream_review || [])) {
      if (reviewableIds.has(issue.reference)) {
        allIssuesForUpstreamReview.push({ ...issue, section_id: section.section_id, section_name: section.section_name });
      }
    }

    sections.push({ ...section, rows: newRows });
  }

  return {
    session_id: sessionId,
    sections,
    reconciliation_items: draftResult.reconciliation_items,
    excluded: draftResult.excluded,
    quality_audit_trail: auditTrail,
    issues_for_upstream_review: allIssuesForUpstreamReview,
    blocked_row_ids: [...blocked],
  };
}
