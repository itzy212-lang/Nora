// api/debug-e2e-audit.js
//
// TEMPORARY, diagnostic-only endpoint for the final end-to-end
// acceptance audit (2026-09-19) — read-only, runs D1->D2->D3->D4->D5->D6
// against a real session and returns everything, for audit purposes
// only. Removed and confirmed removed before this audit is reported
// complete.

import { createClient } from '@supabase/supabase-js';
import { assembleCanonicalGenerationInput } from './lib/soc-brain-v2/generation-input.js';
import { checkGenerationBarrier } from './lib/soc-brain-v2/generation-barrier.js';
import { reconcile } from './lib/soc-brain-v2/reconciliation.js';
import { draft } from './lib/soc-brain-v2/drafting.js';
import { runFidelityAudit, applyRepairs } from './lib/soc-brain-v2/fidelity-audit.js';
import { runQualityAudit } from './lib/soc-brain-v2/quality-audit.js';
import { runPostQualityGuard } from './lib/soc-brain-v2/factual-guard.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DEBUG_KEY = 'e2e-9k3m7-final-audit-2026';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(404).end();
  if (req.query?.key !== DEBUG_KEY) return res.status(404).end();

  const sessionId = req.query?.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });
  const apiKey = process.env.OPENAI_API_KEY;

  try {
    const barrier = await checkGenerationBarrier(supabase, sessionId);

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

    const canonicalInput = await assembleCanonicalGenerationInput(supabase, { sessionId, projectId, aoId });
    const reconciliation = await reconcile(supabase, { sessionId, projectId, aoId, apiKey });
    const draftResult = await draft(supabase, { sessionId, projectId, aoId, apiKey, userBrain });
    const fidelityResult = await runFidelityAudit(supabase, { sessionId, projectId, aoId, draftResult, apiKey });
    const { repairedDraft, auditTrail: repairTrail } = applyRepairs(draftResult, fidelityResult.findings);

    const repairedRowIds = new Set(repairTrail.map(r => r.draft_row_id));
    const blockedRowIds = fidelityResult.findings
      .filter(f => f.severity === 'blocking' && f.draft_row_id && !repairedRowIds.has(f.draft_row_id))
      .map(f => f.draft_row_id);

    const qualityResult = await runQualityAudit(supabase, {
      sessionId, projectId, aoId, draftResult: repairedDraft, blockedRowIds, apiKey, userBrain,
    });

    const d4ForGuard = { sections: repairedDraft.sections.map(s => ({ section_id: s.section_id, section_name: s.section_name, rows: s.rows })) };
    const d5ForGuard = { sections: qualityResult.sections.map(s => ({ section_id: s.section_id, section_name: s.section_name, rows: s.rows })) };
    const guardResult = await runPostQualityGuard(supabase, { sessionId, d4Draft: d4ForGuard, d5Draft: d5ForGuard, blockedRowIds, apiKey });

    return res.status(200).json({
      d1_barrier: barrier,
      d1_sections: canonicalInput.sections,
      d2_items_count: reconciliation.items.length,
      d2_recovered: reconciliation.items.filter(i => i.recovered),
      d2_excluded: reconciliation.excluded,
      d3_sections: draftResult.sections,
      d4_findings: fidelityResult.findings,
      d4_status: fidelityResult.status,
      d4_repair_trail: repairTrail,
      d4_blocked_row_ids: blockedRowIds,
      d5_changed_rows: qualityResult.quality_audit_trail,
      d5_issues: qualityResult.issues_for_upstream_review,
      d6_audit_trail: guardResult.audit_trail,
      d6_guard_findings: guardResult.guard_findings,
      d6_status: guardResult.status,
      final_sections: guardResult.sections,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
