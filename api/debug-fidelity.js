// api/debug-fidelity.js
//
// TEMPORARY, diagnostic-only endpoint for Phase D4 acceptance
// verification (2026-09-19) — same pattern as its D2/D3 predecessors,
// removed once this specific verification is complete.
//
// Two modes, both strictly read-only with respect to production data:
// - default: runs D1 -> D2 -> D3 -> D4 against the real session and
//   returns the genuine Fidelity Audit findings.
// - ?corrupt=1: runs the same pipeline, then deliberately corrupts an
//   IN-MEMORY COPY of the D3 draft (changes the active 450mm
//   measurement to 650mm) and runs D4 against that copy only. Nothing
//   corrupted is ever persisted or written back.

import { createClient } from '@supabase/supabase-js';
import { draft } from './lib/soc-brain-v2/drafting.js';
import { runFidelityAudit } from './lib/soc-brain-v2/fidelity-audit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DEBUG_KEY = 'd4acc-3q7z8-fidelity-verify-2026';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(404).end();
  if (req.query?.key !== DEBUG_KEY) return res.status(404).end();

  const sessionId = req.query?.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });

  try {
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

    const draftResult = await draft(supabase, {
      sessionId, projectId, aoId,
      apiKey: process.env.OPENAI_API_KEY,
      userBrain,
    });

    let testDraft = draftResult;
    let corrupted = false;
    if (req.query?.corrupt === '1') {
      corrupted = true;
      // Deep copy - the original draftResult is never touched, and
      // nothing here is ever written to any table.
      testDraft = JSON.parse(JSON.stringify(draftResult));
      for (const section of testDraft.sections) {
        for (const row of section.rows) {
          if (row.observation.includes('450mm')) {
            row.observation = row.observation.replace(/450mm/g, '650mm');
          }
        }
      }
    }

    const audit = await runFidelityAudit(supabase, {
      sessionId, projectId, aoId,
      draftResult: testDraft,
      apiKey: process.env.OPENAI_API_KEY,
    });

    return res.status(200).json({ corrupted, draft: testDraft.sections, audit });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
