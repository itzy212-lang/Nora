// api/send-email-push.js
//
// New endpoint (2026-08-14), part of fixing the notification system.
// Sends a real, background-capable Web Push notification for a
// specific incoming email — called automatically by a database
// trigger the moment a new email is inserted, not dependent on the
// app being open at all. Reuses the exact same web-push sending
// pattern already proven working in cron-push-notify.js (that
// endpoint's own sending logic was always correct; its problem was an
// auth check that silently rejected every real invocation, fixed
// separately).

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import crypto from 'crypto';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function constantTimeEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  const padded = Buffer.alloc(128);
  bufA.copy(padded);
  const paddedB = Buffer.alloc(128);
  bufB.copy(paddedB);
  return crypto.timingSafeEqual(padded, paddedB) && bufA.length === bufB.length;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const triggerSecret = process.env.SEND_EMAIL_PUSH_TRIGGER_SECRET;
  if (!token || !triggerSecret || !constantTimeEquals(token, triggerSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { email_id } = req.body || {};
    if (!email_id) return res.status(400).json({ error: 'email_id is required' });
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return res.status(500).json({ error: 'VAPID keys not configured' });
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:help@sq1consulting.co.uk',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );

    const sb = getSupabase();

    const { data: email } = await sb
      .from('emails')
      .select('id, subject, sender_name, sender_email, user_id')
      .eq('id', email_id)
      .maybeSingle();
    if (!email) return res.status(404).json({ error: 'Email not found' });

    // The emails.user_id column holds a mix of representations
    // (auth UUID for some rows, plain email address for others,
    // occasionally null on legacy rows) while push_subscriptions.user_id
    // is always the plain email address (see usePushNotifications.js).
    // Previously this queried ALL active subscriptions with no
    // ownership filter at all — every new email, from any user's
    // connected mailbox, was pushed to every logged-in device. Only
    // looked safe so far because there has only ever been one real
    // subscriber; it would leak across accounts the moment a second
    // user connects. Resolve to the owner's actual email first so we
    // can target only their subscriptions.
    let ownerEmail = null;
    if (email.user_id) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(email.user_id);
      if (isUuid) {
        const { data: userData } = await sb.auth.admin.getUserById(email.user_id);
        ownerEmail = userData?.user?.email || null;
      } else {
        ownerEmail = email.user_id;
      }
    }

    if (!ownerEmail) {
      console.warn('[send-email-push] Could not resolve owner for email', email_id, '- skipping to avoid a cross-user broadcast');
      return res.status(200).json({ ok: true, sent: 0, message: 'Could not resolve email owner' });
    }

    const { data: subscriptions } = await sb
      .from('push_subscriptions')
      .select('*')
      .eq('is_active', true)
      .ilike('user_id', ownerEmail);
    if (!subscriptions?.length) return res.status(200).json({ ok: true, sent: 0, message: 'No active subscriptions for this user' });

    const payload = JSON.stringify({
      title: `📧 ${email.sender_name || email.sender_email || 'New email'}`,
      body: email.subject || '(no subject)',
      tag: `email-${email.id}`,
      url: `/?email=${email.id}`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    });

    let sent = 0, failed = 0;
    for (const sub of subscriptions) {
      try {
        // Fixed: no urgency/TTL was ever set, meaning this relied on
        // web-push's default (normal) priority - confirmed live, a
        // real notification was sent successfully (HTTP 200) within 2
        // minutes of the email arriving, but didn't actually reach the
        // Android device for close to an hour, consistent with
        // Android's own battery-optimisation/Doze deferring a
        // normal-priority FCM message rather than delivering it
        // immediately. urgency: 'high' explicitly asks the push
        // service to treat this as time-sensitive and bypass that
        // batching.
        // Corrected immediately after: an initial TTL: 300 (5 minutes)
        // was a real mistake, not an improvement - confirmed live, a
        // second test with that TTL in place produced NO notification
        // at all after 20+ minutes, worse than before. If Android
        // defers actual delivery past the TTL (which it demonstrably
        // can, well past 5 minutes), FCM simply discards the message
        // rather than delivering it late - for a "you have a new
        // email" notification, late is clearly better than silently
        // dropped, so a generous 24-hour TTL keeps it queued for
        // delivery whenever the device actually wakes, rather than
        // giving up.
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { urgency: 'high', TTL: 86400 },
        );
        sent++;
      } catch (err) {
        failed++;
        // Fixed 2026-08-22, real, confirmed bug — traced from live
        // logs: two subscriptions from June/July have failed on
        // every single send since, but were never cleaned up,
        // because this only ever recognised 410/404 as 'this
        // subscription is dead'. The actual failure they produce is
        // 403 (Forbidden), which was silently left in place forever.
        if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
          await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
        console.warn('[send-email-push] Send failed:', err.statusCode, err.message?.slice(0, 100));
      }
    }

    return res.status(200).json({ ok: true, sent, failed });
  } catch (err) {
    console.error('[send-email-push] Fatal:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
