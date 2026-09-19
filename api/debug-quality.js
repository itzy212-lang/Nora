// api/debug-quality.js
//
// TEMPORARY, diagnostic-only endpoint for Phase D5 acceptance
// verification (2026-09-19) — same pattern as its D2/D3/D4
// predecessors, removed once this specific verification is complete.
//
// Modes:
// - default: runs D1 -> D2 -> D3 -> D4 (+ repair) -> D5 against the
//   real session, read-only throughout, and returns the full chain.
// - ?controlled=awkward: an in-memory-only, deliberately awkward but
//   factually complete synthetic row, run through D5 alone. Nothing
//   persisted.
// - ?controlled=temptation: an in-memory-only synthetic row where
//   improving the prose would be easy only by inventing a missing
//   fact. Nothing persisted.

import { createClient } from '@supabase/supabase-js';
import { draft } from './lib/soc-brain-v2/drafting.js';
import { runFidelityAudit, applyRepairs } from './lib/soc-brain-v2/fidelity-audit.js';
import { runQualityAudit } from './lib/soc-brain-v2/quality-audit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DEBUG_KEY = 'd5acc-5k2n7-quality-verify-2026';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(404).end();
  if (req.query?.key !== DEBUG_KEY) return res.status(404).end();

  try {
    if (req.query?.controlled === 'awkward') {
      const syntheticDraft = {
        session_id: 'controlled-test', reconciliation_items: [], excluded: [],
        sections: [{
          section_id: 'sec-x', section_name: 'Controlled Test Room',
          rows: [{
            row_id: 'row-controlled-1',
            observation: "There's a crack coming off the top right of the window and going up towards the ceiling and it's about half a mil.",
            element: 'window', source_item_ids: ['synthetic-1'],
          }],
        }],
      };
      const result = await runQualityAudit(supabase, { sessionId: 'controlled-test', draftResult: syntheticDraft, apiKey: process.env.OPENAI_API_KEY });
      return res.status(200).json({ mode: 'awkward', before: syntheticDraft.sections[0].rows[0], after: result.sections[0].rows[0], audit_trail: result.quality_audit_trail });
    }

    if (req.query?.controlled === 'temptation') {
      const syntheticDraft = {
        session_id: 'controlled-test', reconciliation_items: [], excluded: [],
        sections: [{
          section_id: 'sec-x', section_name: 'Controlled Test Room',
          rows: [{
            row_id: 'row-controlled-2',
            observation: 'A measurement of 200mm was recorded in relation to the party wall.',
            element: 'party wall', source_item_ids: ['synthetic-2'],
          }],
        }],
      };
      const result = await runQualityAudit(supabase, { sessionId: 'controlled-test', draftResult: syntheticDraft, apiKey: process.env.OPENAI_API_KEY });
      return res.status(200).json({ mode: 'temptation', before: syntheticDraft.sections[0].rows[0], after: result.sections[0].rows[0], audit_trail: result.quality_audit_trail, issues_for_upstream_review: result.issues_for_upstream_review });
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

    const draftResult = await draft(supabase, { sessionId, projectId, aoId, apiKey: process.env.OPENAI_API_KEY, userBrain });
    const fidelity = await runFidelityAudit(supabase, { sessionId, projectId, aoId, draftResult, apiKey: process.env.OPENAI_API_KEY });
    const { repairedDraft, auditTrail: repairTrail } = applyRepairs(draftResult, fidelity.findings);

    const repairedRowIds = new Set(repairTrail.map(r => r.draft_row_id));
    const blockedRowIds = fidelity.findings
      .filter(f => f.severity === 'blocking' && f.draft_row_id && !repairedRowIds.has(f.draft_row_id))
      .map(f => f.draft_row_id);

    const quality = await runQualityAudit(supabase, {
      sessionId, projectId, aoId,
      draftResult: repairedDraft,
      blockedRowIds,
      apiKey: process.env.OPENAI_API_KEY,
      userBrain,
    });

    return res.status(200).json({
      d3_draft: draftResult.sections,
      d4_findings: fidelity,
      d4_repair_trail: repairTrail,
      blocked_row_ids: blockedRowIds,
      d5_output: quality.sections,
      d5_audit_trail: quality.quality_audit_trail,
      d5_issues_for_upstream_review: quality.issues_for_upstream_review,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
