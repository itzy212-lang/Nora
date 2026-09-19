// api/debug-draft.js
//
// TEMPORARY, diagnostic-only endpoint for the D3 safe-synthesis
// acceptance recheck (2026-09-19) — same pattern as its predecessor,
// removed again once this specific verification is complete.

import { createClient } from '@supabase/supabase-js';
import { draft } from './lib/soc-brain-v2/drafting.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DEBUG_KEY = 'd3rechk-6t8w1-draft-verify-2026';

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

    const result = await draft(supabase, {
      sessionId, projectId, aoId,
      apiKey: process.env.OPENAI_API_KEY,
      userBrain,
    });
    return res.status(200).json({ sections: result.sections });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
