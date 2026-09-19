// api/lib/soc-brain-v2/production-pipeline.js
//
// Nora SOC v2 — final integration phase: the actual production
// orchestration D1 -> D2 -> D3 -> D4(+repair) -> D5 -> D6 -> reference
// codes -> dataForRender-shaped output, called directly by the real
// Generate button's handler (api/generate-soc.js), not a debug/test
// endpoint. Every stage below is the exact, frozen module already
// built and accepted (D1-D6) - this file adds no new drafting,
// reconciliation, audit, or guard logic of its own. It only:
//   - sequences the calls in the accepted order,
//   - avoids re-running D2 twice (passes reconciliation into draft()),
//   - computes blockedRowIds the same way every prior live
//     verification in this project did,
//   - applies the human-facing reference codes (presentation only),
//   - shapes the result to match what generate-soc.js's existing
//     rendering/persistence code already expects (dataForRender),
//   - fails loudly and safely, tagged with the stage that failed,
//     rather than ever silently falling back to the legacy pipeline.

import { checkGenerationBarrier } from './generation-barrier.js';
import { reconcile } from './reconciliation.js';
import { draft } from './drafting.js';
import { runFidelityAudit, applyRepairs } from './fidelity-audit.js';
import { runQualityAudit } from './quality-audit.js';
import { runPostQualityGuard } from './factual-guard.js';
import { applyHumanReferenceCodes } from './reference-codes.js';

export const SOC_V2_PIPELINE_VERSION = 'v1.0.0';

/**
 * Error carrying which v2 stage failed, for safe, specific failure
 * reporting - never a raw stack trace to the end user, but enough for
 * diagnosis. `stage` is one of: barrier, d2, d3, d4, d5, d6.
 */
export class SocV2StageError extends Error {
  constructor(stage, cause) {
    super(`SOC_V2_GENERATION_FAILED: stage ${stage} — ${cause?.message || cause}`);
    this.stage = stage;
    this.cause = cause;
  }
}

/**
 * Runs the complete, accepted D1-D6 pipeline for one session and
 * returns dataForRender-shaped output (sections/site_notes/actions/
 * emails_required) plus a distinct, namespaced metadata block for
 * persistence/diagnostics. Read-only with respect to Phase C evidence
 * throughout - every stage it calls already is.
 */
export async function runSocV2Pipeline(supabase, { sessionId, projectId, aoId, apiKey, userBrain, model }) {
  let barrier;
  try {
    barrier = await checkGenerationBarrier(supabase, sessionId);
  } catch (err) {
    throw new SocV2StageError('barrier', err);
  }
  if (!barrier.ok) {
    const reasonText = {
      notes_still_processing: 'one or more notes are still being processed',
      notes_failed_processing: 'one or more notes failed to process and have not been retried',
      pending_clarification_unanswered: 'a live clarification question has not been answered yet' + (barrier.pending_clarification?.question ? ` ("${barrier.pending_clarification.question}")` : ''),
    }[barrier.reason] || barrier.reason;
    const err = new Error(`Cannot generate yet — ${reasonText}. Please wait or resolve this, then try again.`);
    err.isBarrierBlock = true;
    throw err;
  }

  let reconciliation;
  try {
    reconciliation = await reconcile(supabase, { sessionId, projectId, aoId, apiKey });
  } catch (err) {
    throw new SocV2StageError('d2', err);
  }

  let draftResult;
  try {
    draftResult = await draft(supabase, { sessionId, projectId, aoId, apiKey, model, userBrain, precomputedReconciliation: reconciliation });
  } catch (err) {
    throw new SocV2StageError('d3', err);
  }

  let fidelityResult, repairedDraft, repairTrail, blockedRowIds;
  try {
    fidelityResult = await runFidelityAudit(supabase, { sessionId, projectId, aoId, draftResult, apiKey });
    const repair = applyRepairs(draftResult, fidelityResult.findings);
    repairedDraft = repair.repairedDraft;
    repairTrail = repair.auditTrail;
    const repairedRowIds = new Set(repairTrail.map(r => r.draft_row_id));
    blockedRowIds = fidelityResult.findings
      .filter(f => f.severity === 'blocking' && f.draft_row_id && !repairedRowIds.has(f.draft_row_id))
      .map(f => f.draft_row_id);
  } catch (err) {
    throw new SocV2StageError('d4', err);
  }

  let qualityResult;
  try {
    qualityResult = await runQualityAudit(supabase, {
      sessionId, projectId, aoId, draftResult: repairedDraft, blockedRowIds, apiKey, model, userBrain,
    });
  } catch (err) {
    throw new SocV2StageError('d5', err);
  }

  let guardResult;
  try {
    const d4ForGuard = { sections: repairedDraft.sections.map(s => ({ section_id: s.section_id, section_name: s.section_name, rows: s.rows })) };
    const d5ForGuard = { sections: qualityResult.sections.map(s => ({ section_id: s.section_id, section_name: s.section_name, rows: s.rows })) };
    guardResult = await runPostQualityGuard(supabase, { sessionId, d4Draft: d4ForGuard, d5Draft: d5ForGuard, blockedRowIds, apiKey, model });
  } catch (err) {
    throw new SocV2StageError('d6', err);
  }

  const finalSectionsWithRefs = applyHumanReferenceCodes(guardResult.sections);

  const sectionsForRender = finalSectionsWithRefs.map((s, idx) => ({
    number: idx + 1,
    title: s.section_name,
    rows: s.rows.map(r => ({ ref: r.human_reference, observation: r.observation, action: 'Record only' })),
  }));

  const siteNotesForRender = reconciliation.site_notes.map(sn => ({
    topic: 'general',
    description: sn.resolved_content,
  }));

  const d6ActionCounts = guardResult.audit_trail.reduce((acc, a) => {
    acc[a.action] = (acc[a.action] || 0) + 1;
    return acc;
  }, {});

  return {
    sections: sectionsForRender,
    site_notes: siteNotesForRender,
    actions: [],
    emails_required: [],
    unresolved_notes: fidelityResult.findings
      .filter(f => f.severity === 'blocking')
      .map(f => f.evidence_summary || f.required_action),
    // Namespaced diagnostic/audit block - kept distinct from the OLD
    // pipeline's own metadata fields so the two are never confused.
    // Persistence location: this whole object is saved as part of
    // soc_reports.structured_data (see generate-soc.js).
    _soc_v2_metadata: {
      pipeline: 'soc_v2',
      pipeline_version: SOC_V2_PIPELINE_VERSION,
      d1_status: 'pass',
      d2_items_count: reconciliation.items.length,
      d2_recovered_count: reconciliation.items.filter(i => i.recovered).length,
      d2_excluded_count: reconciliation.excluded.length,
      d3_row_count: draftResult.sections.reduce((sum, s) => sum + s.rows.length, 0),
      d4_status: fidelityResult.status,
      d4_findings: fidelityResult.findings.map(f => ({ type: f.type, severity: f.severity, row_id: f.draft_row_id, repaired: repairTrail.some(r => r.draft_row_id === f.draft_row_id) })),
      d4_blocked_row_ids: blockedRowIds,
      d5_changed_count: qualityResult.quality_audit_trail.length,
      d5_issues: qualityResult.issues_for_upstream_review,
      d6_status: guardResult.status,
      d6_accept_d5_count: d6ActionCounts.ACCEPT_D5 || 0,
      d6_revert_to_d4_count: d6ActionCounts.REVERT_TO_D4 || 0,
      d6_flag_uncertain_count: d6ActionCounts.FLAG_UNCERTAIN || 0,
      d6_guard_findings_count: guardResult.guard_findings.length,
      row_identity: finalSectionsWithRefs.flatMap(s => s.rows.map(r => ({
        row_id: r.row_id,
        section_id: s.section_id,
        source_item_ids: r.source_item_ids,
        human_reference: r.human_reference,
      }))),
    },
  };
}
