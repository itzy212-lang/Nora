// api/notification-junk.js
// Called by the service worker when the user taps "Junk" on an email notification.
// Moves that one email to Nora's Junk folder (junk_at), exactly what the inbox's
// "mark as junk" does: recoverable via "Not junk" for 30 days, then purged. Only changes
// Nora's own copy, so it behaves the same for every user and either mail provider.
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
    const { error } = await sb
      .from('emails')
      .update({ junk_at: new Date().toISOString() })
      .eq('id', email_id)
      .is('junk_at', null);
    if (error) return res.status(500).json({ error: 'Could not move this email' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notification-junk] error:', err.message);
    return res.status(500).json({ error: 'Could not move this email' });
  }
}
