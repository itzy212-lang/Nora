// api/debug-guard.js
//
// TEMPORARY, diagnostic-only endpoint for Phase D6 acceptance
// verification (2026-09-19) — gated, read-only, to be removed and its
// removal committed and deployed before this phase is reported
// complete.
//
// Modes:
// - default: runs D1 -> D2 -> D3 -> D4 (+repair) -> D5 -> D6 against
//   the real session and returns the genuine output.
// - ?controlled=1: runs three additional in-memory-only controlled
//   pairs (safe rewrite; 450->650 corruption; subtle spatial
//   corruption) through the real D6 semantic guard. Nothing here is
//   persisted.

import { createClient } from '@supabase/supabase-js';
import { draft } from './lib/soc-brain-v2/drafting.js';
import { runFidelityAudit, applyRepairs } from './lib/soc-brain-v2/fidelity-audit.js';
import { runQualityAudit } from './lib/soc-brain-v2/quality-audit.js';
import { runPostQualityGuard } from './lib/soc-brain-v2/factual-guard.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DEBUG_KEY = 'd6acc-8r2n5-guard-verify-2026';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(404).end();
  if (req.query?.key !== DEBUG_KEY) return res.status(404).end();

  const apiKey = process.env.OPENAI_API_KEY;

  try {
    if (req.query?.controlled === '1') {
      const section = { section_id: 'sec-test', section_name: 'First Floor Front Bedroom' };
      const row = (id, obs) => ({ row_id: id, observation: obs, element: 'party wall', source_item_ids: ['c-synthetic'] });

      const cases = {
        safe_rewrite: {
          d4: 'A hairline crack measuring approximately 450mm was noted, extending diagonally from the corner.',
          d5: 'A hairline crack, approximately 450mm in length, extends diagonally from the corner.',
        },
        measurement_corruption: {
          d4: 'A hairline crack measuring approximately 450mm was noted.',
          d5: 'A hairline crack measuring approximately 650mm was noted.',
        },
        subtle_spatial_corruption: {
          d4: 'Localised staining was present immediately above the crack.',
          d5: 'Localised staining was present adjacent to the crack.',
        },
      };

      const results = {};
      for (const [key, pair] of Object.entries(cases)) {
        const d4Draft = { sections: [{ ...section, rows: [row(`row-${key}`, pair.d4)] }] };
        const d5Draft = { sections: [{ ...section, rows: [row(`row-${key}`, pair.d5)] }] };
        const guard = await runPostQualityGuard(supabase, { sessionId: 'synthetic', d4Draft, d5Draft, apiKey });
        results[key] = { d4: pair.d4, d5: pair.d5, audit: guard.audit_trail[0], final: guard.sections[0].rows[0].observation };
      }

      return res.status(200).json(results);
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

    const d4ForGuard = { sections: repairedDraft.sections.map(s => ({ section_id: s.section_id, section_name: s.section_name, rows: s.rows })) };
    const d5ForGuard = { sections: qualityResult.sections.map(s => ({ section_id: s.section_id, section_name: s.section_name, rows: s.rows })) };

    const guardResult = await runPostQualityGuard(supabase, {
      sessionId, d4Draft: d4ForGuard, d5Draft: d5ForGuard, blockedRowIds, apiKey,
    });

    return res.status(200).json({
      blocked_row_ids: blockedRowIds,
      d5_changed_rows: qualityResult.quality_audit_trail,
      d6_audit_trail: guardResult.audit_trail,
      d6_guard_findings: guardResult.guard_findings,
      d6_status: guardResult.status,
      final_sections: guardResult.sections,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
