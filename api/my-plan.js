// api/my-plan.js
//
// GET /api/my-plan  (Authorization: Bearer <user token>)
// The signed-in user's own plan, in plain words, for the left-hand menu: { label, note, addons, is_admin, ... }.
// Works the same for every user and every mail/storage provider.
import { createClient } from '@supabase/supabase-js';
import { describeAccess, loadPlan } from './lib/entitlements.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const h = req.headers?.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user?.id) return res.status(401).json({ error: 'Not signed in' });

  const row = await loadPlan(supabase, user.id);
  const d = describeAccess(row);
  return res.status(200).json({ ...d, is_admin: !!row?.is_admin });
}
