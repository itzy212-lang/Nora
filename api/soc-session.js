// api/soc-session.js
// Returns saved notes for an existing SOC session.
// Called on SOC mount to restore in-progress sessions after page reload.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'No session_id' });

    const { data, error } = await supabase
      .from('soc_notes')
      .select('sequence, raw_note, ai_response, current_section, note_type, note_status, observation_id')
      .eq('session_id', session_id)
      .order('sequence', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({
      session_id,
      notes: data || [],
      count: data?.length || 0,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
