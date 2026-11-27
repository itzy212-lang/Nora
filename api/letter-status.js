// api/letter-status.js
//
// GET /api/letter-status?id=<posted_letters.id>  (Authorization: Bearer <user token>)
// Refreshes one posted letter from Intelliprint (status, tracking number) and returns it with the
// Royal Mail tracking link. The tracking number only exists once the letter is tracked and shipped,
// so this is how the AO card's link appears after posting. Only the owner of the letter can refresh it.
import { createClient } from '@supabase/supabase-js';
import { royalMailTrackingUrl } from './lib/letter-post.js';
import { retrievePrint } from './lib/intelliprint.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function userIdFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return error || !user?.id ? null : user.id;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await userIdFrom(req);
  if (!userId) return res.status(401).json({ error: 'Not signed in' });
  const id = String(req.query?.id || '');
  if (!id) return res.status(400).json({ error: 'No letter given' });

  const { data: row } = await supabase.from('posted_letters').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Letter not found' });

  let tracking = row.tracking_number, status = row.status;
  if (row.provider_print_id && process.env.INTELLIPRINT_API_KEY) {
    try {
      const print = await retrievePrint(process.env.INTELLIPRINT_API_KEY, row.provider_print_id);
      const letter = print?.letters?.[0] || {};
      // Logged (no secrets, no addresses) so we can see exactly what Intelliprint reports for test and live letters.
      console.log('[letter-status] intelliprint', JSON.stringify({ print_keys: Object.keys(print || {}), print_status: print?.status ?? null, confirmed: print?.confirmed ?? null, testmode: print?.testmode ?? null, letter_keys: Object.keys(letter), letter_status: letter.status ?? null }));
      tracking = letter.tracking_number || tracking;
      status = letter.status || status;
      if (tracking !== row.tracking_number || status !== row.status) {
        await supabase.from('posted_letters').update({ tracking_number: tracking, status, last_status_at: new Date().toISOString() }).eq('id', id);
      }
    } catch (err) { console.error('[letter-status] refresh failed:', err.message); }
  }
  return res.status(200).json({ id, status, tracking_number: tracking, tracking_url: royalMailTrackingUrl(tracking), sheets: row.sheets, testmode: row.testmode });
}
