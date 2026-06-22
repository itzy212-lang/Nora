// api/soc-sessions.js
// Returns all SOC sessions for a project, for the sidebar history.
// Groups soc_notes by session_id, returns summary per session.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ error: 'No project_id' });

  const { data, error } = await supabase
    .from('soc_notes')
    .select('session_id, ao_id, current_section, inferred_section, created_at, sequence')
    .eq('project_id', project_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Group by session_id
  const sessionMap = {};
  for (const row of (data || [])) {
    if (!sessionMap[row.session_id]) {
      sessionMap[row.session_id] = {
        sessionId: row.session_id,
        aoId: row.ao_id,
        noteCount: 0,
        lastUpdated: row.created_at,
        aoAddress: null,
      };
    }
    sessionMap[row.session_id].noteCount++;
    if (row.created_at > sessionMap[row.session_id].lastUpdated) {
      sessionMap[row.session_id].lastUpdated = row.created_at;
    }
  }

  // Fetch AO addresses from projects table
  if (Object.keys(sessionMap).length > 0) {
    const { data: proj } = await supabase
      .from('projects')
      .select('id, aos')
      .eq('id', project_id)
      .single();

    if (proj?.aos) {
      for (const session of Object.values(sessionMap)) {
        const ao = proj.aos.find(a => String(a.id) === String(session.aoId) || String(a.num) === String(session.aoId));
        if (ao) {
          session.aoAddress = ao.address || ao.ao_address || ao.reg_addr || null;
        }
      }
    }
  }

  const sessions = Object.values(sessionMap)
    .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

  return res.status(200).json({ sessions });
}
