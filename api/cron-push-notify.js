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
  const isCron = req.headers['x-vercel-cron'] === '1';
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

    // Load AOs from adjoining_owners table
    const { data: aoRows } = await sb
      .from('adjoining_owners')
      .select('*')
      .in('project_id', projects.map(p => p.id));

    const aosByProject = {};
    (aoRows || []).forEach(ao => {
      if (!aosByProject[ao.project_id]) aosByProject[ao.project_id] = [];
      aosByProject[ao.project_id].push(ao);
    });

    // Load all push subscriptions
    const { data: subscriptions } = await sb.from('push_subscriptions').select('*');
    if (!subscriptions?.length) return res.status(200).json({ ok: true, sent: 0, message: 'No push subscriptions' });

    const notifications = [];

    for (const project of projects) {
      const addr = project.bo_premise_address || project.ref || project.id;
      const tableAos = aosByProject[project.id] || [];
      const jsonAos = Array.isArray(project.aos) ? project.aos : [];
      const aos = tableAos.length > 0 ? tableAos : jsonAos;

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
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
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
