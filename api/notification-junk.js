// api/notification-junk.js
// Called by the service worker when the user taps "Delete" on an email notification.
// Deletes that one email from Nora, exactly what the inbox's delete button does (Nora's
// own copy only, so it behaves the same for every user and either mail provider).
// (File keeps its original name; it first shipped as a "Junk" button.)
import { createClient } from '@supabase/supabase-js';
import { verifyJunkToken } from './lib/notification-junk-token.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email_id, token } = req.body || {};
  if (!email_id || !token || !verifyJunkToken(email_id, token)) {
    return res.status(401).json({ error: 'Not allowed' });
  }
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await sb.from('emails').delete().eq('id', email_id);
    if (error) return res.status(500).json({ error: 'Could not delete this email' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notification-junk] error:', err.message);
    return res.status(500).json({ error: 'Could not delete this email' });
  }
}
