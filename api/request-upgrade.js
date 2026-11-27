// api/request-upgrade.js
//
// POST /api/request-upgrade  { addon: 'assistant' | 'soc' }   (Authorization: Bearer <user token>)
// The signed-in user asks for a bolt-on. There is no billing yet, so this just records the request; it shows
// against that user on the Admin page (api/admin-users.js) and clears when the bolt-on is switched on for them.
// One open request per user and bolt-on. Works the same for every user and every mail/storage provider.
import { createClient } from '@supabase/supabase-js';
import { ADDONS } from './lib/entitlements.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const h = req.headers?.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user?.id) return res.status(401).json({ error: 'Not signed in' });

  const addon = req.body?.addon;
  if (!ADDONS.includes(addon)) return res.status(400).json({ error: 'Unknown bolt-on' });

  const { data: open } = await supabase.from('upgrade_requests').select('id').eq('user_id', user.id).eq('addon', addon).is('handled_at', null).maybeSingle();
  if (!open) {
    const { error: insertError } = await supabase.from('upgrade_requests').insert({ user_id: user.id, addon });
    if (insertError && insertError.code !== '23505') return res.status(500).json({ error: 'Could not save your request' });
  }
  return res.status(200).json({ ok: true });
}
