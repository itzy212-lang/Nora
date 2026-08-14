// api/push-subscribe.js
// Saves or removes a Web Push subscription for the current user

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sb = getSupabase();
  const { subscription, user_id } = req.body || {};

  if (!subscription?.endpoint) return res.status(400).json({ error: 'No subscription endpoint' });

  if (req.method === 'DELETE') {
    await sb.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST') {
    // Fixed 2026-08-14: real, confirmed bug — wrote to keys_p256dh/
    // keys_auth, columns that don't exist on push_subscriptions (the
    // real columns are p256dh/auth). The two existing subscription
    // rows have correct data from before this drifted; any new
    // subscription attempt from here would have failed outright.
    const { error } = await sb.from('push_subscriptions').upsert({
      user_id: user_id || 'help@sq1consulting.co.uk',
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh || '',
      auth: subscription.keys?.auth || '',
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
