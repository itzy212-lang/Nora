// api/cron-push-notify.js
// Runs at 9am daily via Vercel cron.
// Finds all AO deadlines expiring TODAY and sends a push notification per deadline.

export const config = { maxDuration: 60 };

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function todayUK() {
  // Get today's date in UK timezone as YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function dateStr(val) {
  if (!val) return null;
  return new Date(val).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

export default async function handler(req, res) {
  // Fixed 2026-08-14: real, confirmed bug present since this endpoint
  // was first built. Checked for a header (x-vercel-cron: '1') that
  // Vercel's real cron invocations never actually send — confirmed
  // directly against Vercel's current documentation and against a real
  // production log line: the scheduled 9am cron was hitting this route
  // exactly on time, every day, and getting an immediate 401 every
  // single time, meaning this endpoint's actual logic — every deadline
  // check, every reminder — had never once run since it was deployed.
  // Vercel's real mechanism is Authorization: Bearer <CRON_SECRET>,
  // using an environment variable of that exact name.
  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = req.method === 'POST' && req.headers['x-nora-manual'] === 'true';
  if (!isCron && !isManual) return res.status(401).json({ error: 'Unauthorized' });

  // Configure VAPID
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:help@sq1consulting.co.uk',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );

  const sb = getSupabase();
  const today = todayUK();

  try {
    // Load all active projects
    const { data: projects } = await sb
      .from('projects')
      .select('id, ref, bo_premise_address, aos, status')
      .neq('status', 'complete')
      .neq('status', 'closed')
      .neq('status', 'award_served')
      .limit(200);

    if (!projects?.length) return res.status(200).json({ ok: true, sent: 0, message: 'No active projects' });

    // Fixed 2026-08-16: removed the adjoining_owners table query
    // entirely — confirmed it has zero deadline-related columns, and
    // was causing real deadlines to be silently missed for any
    // project with rows there (see the note below). The JSON aos
    // column on projects is the actual, confirmed source of this
    // data.

    // Load all push subscriptions
    const { data: subscriptions } = await sb.from('push_subscriptions').select('*');
    if (!subscriptions?.length) return res.status(200).json({ ok: true, sent: 0, message: 'No push subscriptions' });

    const notifications = [];

    for (const project of projects) {
      const addr = project.bo_premise_address || project.ref || project.id;
      const jsonAos = Array.isArray(project.aos) ? project.aos : [];
      // Fixed 2026-08-16: real, confirmed bug, found while verifying
      // this endpoint's actual deadline-finding logic (not just its
      // auth, which was fixed separately) — adjoining_owners has zero
      // deadline-related columns at all, confirmed directly against
      // its schema. The real deadline fields (consentDeadline,
      // s10Deadline etc.) only ever exist in the JSON aos column on
      // projects, confirmed directly against real data. The old
      // 'prefer the table if it has any rows' logic meant any project
      // with rows in adjoining_owners (14 real projects, checked)
      // silently used the deadline-less table instead of the JSON
      // column that actually has the data — those projects' deadlines
      // could never have been found, any day, with no visible error.
      // adjoining_owners structurally cannot hold this data, so always
      // using the JSON column here is correct, not just a workaround.
      const aos = jsonAos;

      for (const ao of aos) {
        const st = (ao.status || '').toLowerCase();
        const awardDone = st === 'complete' || st === 'award_served' || !!(ao.award_served_date || ao.awardServedDate);
        if (awardDone) continue;

        const aoName = ao.name || ao.ao_name || 'Adjoining Owner';

        // Consent deadline — expires today
        const cd = ao.consentDeadline || ao.consent_deadline || ao.ao_consent_deadline;
        if (cd && dateStr(cd) === today && st !== 'dissent' && st !== 'consent') {
          notifications.push({
            title: '⏰ Consent deadline today',
            body: `${aoName} — ${addr}`,
            url: `/?project=${project.id}`,
            tag: `consent-${project.id}-${ao.id || ao.num}`,
          });
        }

        // Section 10 deadline — expires today
        const sd = ao.s10Deadline || ao.s10_deadline || ao.ao_s10_deadline;
        const s104bServed = !!(ao.s104b_served_date || ao.s104bServedDate);
        if (sd && dateStr(sd) === today && !s104bServed) {
          notifications.push({
            title: '⚡ Section 10 deadline today',
            body: `${aoName} — ${addr} — s.10(4)(b) appointment needed`,
            url: `/?project=${project.id}`,
            tag: `s10-${project.id}-${ao.id || ao.num}`,
          });
        }

        // Any other AO-level deadline fields
        const rd = ao.response_deadline || ao.responseDeadline;
        if (rd && dateStr(rd) === today) {
          notifications.push({
            title: '📋 Response deadline today',
            body: `${aoName} — ${addr}`,
            url: `/?project=${project.id}`,
            tag: `response-${project.id}-${ao.id || ao.num}`,
          });
        }
      }
    }

    // Also check diary/calendar events due today
    const { data: diaryItems } = await sb
      .from('calendar_events')
      .select('id, title, description, start_time, project_id')
      .gte('start_time', today + 'T00:00:00')
      .lte('start_time', today + 'T23:59:59')
      .limit(20);

    for (const item of diaryItems || []) {
      const project = projects.find(p => p.id === item.project_id);
      notifications.push({
        title: `📅 ${item.title}`,
        body: project ? `${project.bo_premise_address || project.ref} — ${item.description || ''}` : (item.description || 'Today'),
        url: item.project_id ? `/?project=${item.project_id}` : '/',
        tag: `diary-${item.id}`,
      });
    }

    if (!notifications.length) {
      return res.status(200).json({ ok: true, sent: 0, message: 'Nothing due today' });
    }

    // Send each notification to all subscriptions
    let sent = 0, failed = 0;
    for (const notif of notifications) {
      const payload = JSON.stringify({
        title: notif.title,
        body: notif.body,
        tag: notif.tag,
        url: notif.url,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      });

      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(
            // Fixed 2026-08-14: real, confirmed second bug — the real
            // columns on push_subscriptions are p256dh and auth, not
            // keys_p256dh/keys_auth. Even with the auth check fixed,
            // sending would have continued failing (malformed/missing
            // keys) on every subscription, every time.
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          sent++;
        } catch (err) {
          failed++;
          // Remove expired/invalid subscriptions
          if (err.statusCode === 410 || err.statusCode === 404) {
            await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
          console.warn('[cron-push-notify] Send failed:', err.statusCode, err.message?.slice(0, 100));
        }
      }
    }

    console.log(`[cron-push-notify] ${today}: ${notifications.length} notifications, ${sent} sent, ${failed} failed`);
    return res.status(200).json({ ok: true, today, notifications: notifications.length, sent, failed });

  } catch (err) {
    console.error('[cron-push-notify] Fatal:', err);
    return res.status(500).json({ error: err.message });
  }
}
