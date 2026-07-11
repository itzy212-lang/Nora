// api/briefing.js
// Returns a structured project briefing for Nora to surface in main chat

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sb = getSupabase();
    const now = Date.now();

    // Load all active projects with their AOs
    const { data: projects } = await sb
      .from('projects')
      .select('id, ref, address, bo_premise_address, status, created_at, aos')
      .not('status', 'in', '("complete","closed","award_served")')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!projects?.length) return res.status(200).json({ alerts: [], summary: 'No active projects.' });

    // Load open email_response tasks
    const { data: emailTasks } = await sb
      .from('tasks')
      .select('id, project_id, due_date, status, metadata, title')
      .eq('task_type', 'email_response')
      .eq('status', 'open');

    const tasksByProject = {};
    (emailTasks || []).forEach(t => {
      if (!tasksByProject[t.project_id]) tasksByProject[t.project_id] = [];
      tasksByProject[t.project_id].push(t);
    });

    const alerts = [];

    for (const project of projects) {
      const addr = project.bo_premise_address || project.address || project.ref || project.id;
      const aos = project.aos || [];

      // No AO added after 3 days
      const age = daysSince(project.created_at);
      if (aos.length === 0 && age >= 3) {
        alerts.push({
          level: 'red',
          project: addr,
          message: `No adjoining owner added — project is ${age} days old`,
        });
        continue;
      }

      for (const ao of aos) {
        const aoName = ao.name || ao.ao_name || 'AO';
        const st = (ao.status || '').toLowerCase();
        const resolved = ['consent', 'complete', 'award_served'].includes(st) || !!(ao.award_served_date);
        if (resolved) continue;

        const cd = ao.consentDeadline || ao.consent_deadline || ao.ao_consent_deadline;
        const sd = ao.s10Deadline || ao.s10_deadline || ao.ao_s10_deadline;
        const noticed = !!(ao.noticeServedDate || ao.notice_served_date || ao.ao_notice_served_date || cd);
        const lastChange = ao.last_status_change;
        const staleDays = daysSince(lastChange);

        // Consent deadline overdue
        if (cd && daysUntil(cd) !== null && daysUntil(cd) < 0 && st !== 'dissent') {
          alerts.push({ level: 'red', project: addr, message: `${aoName} — consent deadline expired ${Math.abs(daysUntil(cd))}d ago, serve Section 10` });
        } else if (cd && daysUntil(cd) !== null && daysUntil(cd) <= 3 && daysUntil(cd) >= 0 && st !== 'dissent') {
          alerts.push({ level: 'amber', project: addr, message: `${aoName} — consent deadline in ${daysUntil(cd)}d` });
        }

        // S10 deadline overdue
        if (sd && daysUntil(sd) !== null && daysUntil(sd) < 0) {
          alerts.push({ level: 'red', project: addr, message: `${aoName} — Section 10 expired ${Math.abs(daysUntil(sd))}d ago, serve 10(4)(b)` });
        } else if (sd && daysUntil(sd) !== null && daysUntil(sd) <= 3 && daysUntil(sd) >= 0) {
          alerts.push({ level: 'amber', project: addr, message: `${aoName} — Section 10 expires in ${daysUntil(sd)}d` });
        }

        // Dissent with no surveyor
        if (st === 'dissent' && !ao.agreed_surveyor && !ao.surv_name && !ao.surveyorName) {
          alerts.push({ level: 'amber', project: addr, message: `${aoName} — dissent received, no surveyor appointed yet` });
        }

        // Stale inactivity
        if (noticed && staleDays !== null && staleDays >= 14) {
          alerts.push({ level: 'red', project: addr, message: `${aoName} — no progress for ${staleDays} days` });
        } else if (noticed && staleDays !== null && staleDays >= 10 && staleDays < 14) {
          alerts.push({ level: 'amber', project: addr, message: `${aoName} — no progress for ${staleDays} days` });
        }

        // Email response overdue
        const projectTasks = tasksByProject[project.id] || [];
        for (const task of projectTasks) {
          const taskDays = daysUntil(task.due_date);
          if (taskDays !== null && taskDays <= 0) {
            alerts.push({ level: 'red', project: addr, message: `${aoName} — awaiting response overdue by ${Math.abs(taskDays)}d (${task.title})` });
          } else if (taskDays !== null && taskDays <= 3) {
            alerts.push({ level: 'amber', project: addr, message: `${aoName} — awaiting response due in ${taskDays}d` });
          }
        }
      }
    }

    // Sort: red first, then amber
    alerts.sort((a, b) => {
      if (a.level === b.level) return 0;
      return a.level === 'red' ? -1 : 1;
    });

    const redCount = alerts.filter(a => a.level === 'red').length;
    const amberCount = alerts.filter(a => a.level === 'amber').length;
    const summary = alerts.length === 0
      ? 'All projects are on track — nothing urgent.'
      : `${redCount > 0 ? `${redCount} urgent item${redCount > 1 ? 's' : ''}` : ''}${redCount > 0 && amberCount > 0 ? ' and ' : ''}${amberCount > 0 ? `${amberCount} item${amberCount > 1 ? 's' : ''} approaching` : ''} across your active projects.`;

    return res.status(200).json({ alerts, summary, total: alerts.length, redCount, amberCount });
  } catch (err) {
    console.error('[briefing] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
