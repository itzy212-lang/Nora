// api/debug-quality2.js
//
// TEMPORARY, diagnostic-only endpoint for independent D5 verification
// (2026-09-19) — gated, read-only, removed once this verification is
// recorded. Named distinctly from its predecessor to avoid any
// confusion with the prior, already-removed debug-quality.js.
//
// Modes:
// - default: runs D1 -> D2 -> D3 -> D4 (+repair) -> D5 against the
//   real session and returns the genuine output.
// - ?controlled=1: runs two additional in-memory-only controlled
//   tests (awkward-but-complete prose improvement; a "temptation"
//   case where improving prose would require inventing a fact) with
//   synthetic single-section drafts. Nothing here is persisted.

import { createClient } from '@supabase/supabase-js';
import { draft } from './lib/soc-brain-v2/drafting.js';
import { runFidelityAudit, applyRepairs } from './lib/soc-brain-v2/fidelity-audit.js';
import { runQualityAudit } from './lib/soc-brain-v2/quality-audit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DEBUG_KEY = 'd5acc-4h9j2-quality-verify-2026';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(404).end();
  if (req.query?.key !== DEBUG_KEY) return res.status(404).end();

  const apiKey = process.env.OPENAI_API_KEY;

  try {
    if (req.query?.controlled === '1') {
      const section = { section_id: 'sec-test', section_name: 'First Floor Front Bedroom' };

      // Awkward but factually complete transcript-like wording.
      const awkwardRow = {
        row_id: 'row-awkward-1',
        observation: "There's a crack coming off the top right of the window and going up towards the ceiling and it's about half a mil.",
        element: 'window',
        source_item_ids: ['c-synthetic-1'],
      };
      const awkwardDraft = { sections: [{ ...section, rows: [awkwardRow] }], reconciliation_items: [], excluded: [] };
      const awkwardResult = await runQualityAudit(supabase, { sessionId: 'synthetic', draftResult: awkwardDraft, apiKey });

      // Temptation case: a bare "cracking" fact with no defect detail
      // beyond that - improving readability by adding "hairline" or a
      // direction would require inventing a fact not present.
      const temptationRow = {
        row_id: 'row-temptation-1',
        observation: 'Cracking was noted to the party wall.',
        element: 'party wall',
        source_item_ids: ['c-synthetic-2'],
      };
      const temptationDraft = { sections: [{ ...section, rows: [temptationRow] }], reconciliation_items: [], excluded: [] };
      const temptationResult = await runQualityAudit(supabase, { sessionId: 'synthetic', draftResult: temptationDraft, apiKey });

      return res.status(200).json({
        awkward: { input: awkwardRow.observation, output: awkwardResult.sections[0].rows[0], trail: awkwardResult.quality_audit_trail, issues: awkwardResult.issues_for_upstream_review },
        temptation: { input: temptationRow.observation, output: temptationResult.sections[0].rows[0], trail: temptationResult.quality_audit_trail, issues: temptationResult.issues_for_upstream_review },
      });
    }

    const sessionId = req.query?.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });

    const { data: session } = await supabase.from('ai_sessions').select('id').eq('id', sessionId).maybeSingle();
    if (!session) return res.status(404).json({ error: 'session not found' });

    const { data: notes } = await supabase.from('soc_notes').select('project_id, ao_id').eq('session_id', sessionId).limit(1);
    const projectId = notes?.[0]?.project_id || null;
    const aoId = notes?.[0]?.ao_id || null;

    let userBrain = null;
    if (projectId) {
      const { data: project } = await supabase.from('projects').select('user_id').eq('id', projectId).maybeSingle();
      if (project?.user_id) {
        const { data: brainRow } = await supabase.from('user_brain_v2').select('soc_style_preferences, soc_gold_standard').eq('user_id', project.user_id).maybeSingle();
        userBrain = brainRow || null;
      }
    }

    const draftResult = await draft(supabase, { sessionId, projectId, aoId, apiKey, userBrain });
    const fidelityResult = await runFidelityAudit(supabase, { sessionId, projectId, aoId, draftResult, apiKey });
    const { repairedDraft, auditTrail: repairTrail } = applyRepairs(draftResult, fidelityResult.findings);

    // Rows still carrying an unrepaired blocking finding are excluded from D5.
    const repairedRowIds = new Set(repairTrail.map(r => r.draft_row_id));
    const blockedRowIds = fidelityResult.findings
      .filter(f => f.severity === 'blocking' && f.draft_row_id && !repairedRowIds.has(f.draft_row_id))
      .map(f => f.draft_row_id);

    const qualityResult = await runQualityAudit(supabase, {
      sessionId, projectId, aoId,
      draftResult: repairedDraft,
      blockedRowIds,
      apiKey, userBrain,
    });

    return res.status(200).json({
      fidelity_findings: fidelityResult.findings,
      repair_trail: repairTrail,
      blocked_row_ids: blockedRowIds,
      d5_input: repairedDraft.sections,
      d5_output: qualityResult.sections,
      quality_audit_trail: qualityResult.quality_audit_trail,
      issues_for_upstream_review: qualityResult.issues_for_upstream_review,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
