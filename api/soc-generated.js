// api/soc-generated.js
//
// GET /api/soc-generated?project_id=...   (Authorization: Bearer <user token>)
// Which Schedules of Condition have been generated for a project, so the AO card's timeline can say
// "SOC generated <date>" and link back to the editor. soc_reports is not readable from the browser, so the
// server reads it, after checking the project belongs to the signed-in user. Same for every user.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const h = req.headers?.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user?.id) return res.status(401).json({ error: 'Not signed in' });

  const projectId = String(req.query?.project_id || '');
  if (!projectId) return res.status(400).json({ error: 'No project given' });
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', user.id).maybeSingle();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { data, error } = await supabase.from('soc_reports')
    .select('id, ao_id, ao_address, created_at, updated_at, generation_status')
    .eq('project_id', projectId).eq('generation_status', 'complete')
    .order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: 'Could not load' });
  return res.status(200).json({ reports: data || [] });
}
