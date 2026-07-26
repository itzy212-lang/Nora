// api/briefing.js
// Returns structured per-AO briefing cards for the morning briefing chat view

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

function urgencyScore(level, daysOverdue) {
  // Lower = higher priority
  if (level === 'red') return -(daysOverdue || 0);
  if (level === 'amber') return 100 - (daysOverdue || 0);
  return 999;
}

// Build the status track for an AO
function buildStatusTrack(ao) {
  const st = (ao.status || '').toLowerCase();
  const noticed = !!(ao.noticeServedDate || ao.notice_served_date || ao.ao_notice_served_date || ao.consentDeadline || ao.consent_deadline);
  const dissented = st === 'dissent' || st === 'dissented';
  const consented = st === 'consent';
  const hasSurveyor = !!(ao.surv_name || ao.surveyorName || ao.ao_surveyor_name || ao.aoSurveyorName || ao.agreed_surveyor || ao.agreedSurveyor);
  const isAgreed = !!(ao.agreed_surveyor || ao.agreedSurveyor);
  const s10Served = !!(ao.s10_served_date || ao.s10ServedDate);
  const s104bServed = !!(ao.s104b_served_date || ao.s104bServedDate);
  const schedDone = !!(ao.schedule_of_conditions_date || ao.scheduleOfConditionsDate);
  const awardDone = !!(ao.award_served_date || ao.awardServedDate) || st === 'complete';

  // Track steps: notice → consent period → surveyor appt → schedule of conditions → award
  if (isAgreed) {
    return [
      { label: 'Notice served', done: noticed },
      { label: 'Agreed surveyor', done: true, isAgreed: true },
      { label: 'Schedule of cond.', done: schedDone },
      { label: 'Award', done: awardDone },
    ];
  }

  if (s10Served || s104bServed) {
    return [
      { label: 'Notice served', done: noticed },
      { label: 'Consent period', done: true },
      { label: 'Section 10 served', done: s10Served || s104bServed },
      { label: 's.10(4)(b) appt.', done: s104bServed },
      { label: 'Award', done: awardDone },
    ];
  }

  return [
    { label: 'Notice served', done: noticed },
    { label: 'Consent period', done: dissented || consented },
    { label: 'Surveyor appt.', done: hasSurveyor },
    { label: 'Schedule of cond.', done: schedDone },
    { label: 'Award', done: awardDone },
  ];
}

// Work out what actions are available for this AO
function buildActions(ao, level) {
  const st = (ao.status || '').toLowerCase();
  const hasSurveyor = !!(ao.surv_name || ao.surveyorName || ao.ao_surveyor_name || ao.aoSurveyorName || ao.agreed_surveyor || ao.agreedSurveyor);
  const s10Served = !!(ao.s10_served_date || ao.s10ServedDate);
  const s104bServed = !!(ao.s104b_served_date || ao.s104bServedDate);
  const cd = ao.consentDeadline || ao.consent_deadline || ao.ao_consent_deadline;
  const sd = ao.s10Deadline || ao.s10_deadline || ao.ao_s10_deadline;
  const cdDays = daysUntil(cd);
  const sdDays = daysUntil(sd);

  const actions = [];

  // Section 10(4)(b) — s10 expired, no s104b yet
  if (sd && sdDays !== null && sdDays < 0 && !s104bServed) {
    actions.push({ id: 'generate_s104b', label: 'Generate s.10(4)(b)', style: 'red' });
  }
  // Section 10 — consent expired, dissented but no s10 yet
  else if (cd && cdDays !== null && cdDays < 0 && st !== 'dissent' && !s10Served) {
    actions.push({ id: 'generate_s10', label: 'Generate Section 10', style: 'red' });
  }
  // No surveyor after dissent
  if (st === 'dissent' && !hasSurveyor) {
    actions.push({ id: 'add_surveyor', label: 'Add surveyor', style: 'primary' });
  }
  // Always allow emailing
  const emailAddr = ao.email || ao.surv_email || ao.surveyorEmail || ao.ao_email || '';
  if (emailAddr || ao.name) {
    actions.push({ id: 'email_ao', label: 'Email AO', style: 'ghost' });
  }

  return actions;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sb = getSupabase();

    // Load all active projects with AOs
    const { data: projects } = await sb
      .from('projects')
      .select('id, ref, address, bo_premise_address, status, created_at, aos, fee, fee_invoiced')
      .not('status', 'in', '(\"complete\",\"closed\",\"award_served\")')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!projects?.length) return res.status(200).json({ projects: [], summary: 'No active projects.' });

    // Load unreplied emails (last 60 days) to detect chasing/unhappy contacts
    const since60 = new Date(Date.now() - 60 * 86400000).toISOString();
    const { data: emails } = await sb
      .from('emails')
      .select('id, sender_name, sender_email, subject, received_at, is_replied, project_id, body_preview')
      .not('folder', 'eq', 'sent')
      .or('is_sent.is.null,is_sent.eq.false')
      .or('is_draft.is.null,is_draft.eq.false')
      .eq('is_replied', false)
      .gte('received_at', since60)
      .order('received_at', { ascending: false })
      .limit(200);

    // Group unreplied emails by project
    const emailsByProject = {};
    (emails || []).forEach(e => {
      if (!e.project_id) return;
      if (!emailsByProject[e.project_id]) emailsByProject[e.project_id] = [];
      emailsByProject[e.project_id].push(e);
    });

    // Chasing keywords — emails that suggest frustration or urgency
    const chasingPattern = /chasing|following up|update|any news|heard back|waiting|urgent|anxious|worried|still waiting|not heard|reminder/i;

    const briefingProjects = [];

    for (const project of projects) {
      const addr = project.bo_premise_address || project.address || project.ref || project.id;
      const aos = project.aos || [];
      const projectEmails = emailsByProject[project.id] || [];

      // Find chasing/urgent emails for this project
      const chasingEmails = projectEmails.filter(e =>
        chasingPattern.test(e.subject || '') || chasingPattern.test(e.body_preview || '')
      );
      const unrepliedCount = projectEmails.length;

      const aoCards = [];
      let projectHasAction = false;

      for (const ao of aos) {
        const st = (ao.status || '').toLowerCase();
        const awardDone = !!(ao.award_served_date || ao.awardServedDate) || st === 'complete' || st === 'award_served';
        if (awardDone) continue;

        const aoName = ao.name || ao.ao_name || 'Adjoining Owner';
        const aoAddress = ao.premise || ao.address || ao.ao_address || '';
        const hasSurveyor = !!(ao.surv_name || ao.surveyorName || ao.ao_surveyor_name || ao.aoSurveyorName || ao.agreed_surveyor || ao.agreedSurveyor);
        const surveyorName = ao.surv_name || ao.surveyorName || ao.ao_surveyor_name || ao.aoSurveyorName || ao.agreed_surveyor || ao.agreedSurveyor || '';
        const surveyorFirm = ao.surv_firm || ao.surveyorFirm || ao.ao_surveyor_firm || '';

        const cd = ao.consentDeadline || ao.consent_deadline || ao.ao_consent_deadline;
        const sd = ao.s10Deadline || ao.s10_deadline || ao.ao_s10_deadline;
        const cdDays = daysUntil(cd);
        const sdDays = daysUntil(sd);
        const s10Served = !!(ao.s10_served_date || ao.s10ServedDate);
        const s104bServed = !!(ao.s104b_served_date || ao.s104bServedDate);
        const lastChange = ao.last_status_change;
        const staleDays = daysSince(lastChange);
        const noticed = !!(ao.noticeServedDate || ao.notice_served_date || cd);

        // Determine urgency level and reason
        let level = null;
        let reason = null;
        let daysOverdue = 0;

        if (sd && sdDays !== null && sdDays < 0 && !s104bServed) {
          level = 'red'; daysOverdue = Math.abs(sdDays);
          reason = `Section 10 expired ${Math.abs(sdDays)} day${Math.abs(sdDays) !== 1 ? 's' : ''} ago — s.10(4)(b) appointment needed`;
        } else if (sd && sdDays !== null && sdDays <= 3 && sdDays >= 0) {
          level = 'amber'; daysOverdue = 0;
          reason = `Section 10 expires in ${sdDays} day${sdDays !== 1 ? 's' : ''}`;
        } else if (cd && cdDays !== null && cdDays < 0 && st !== 'dissent') {
          level = 'red'; daysOverdue = Math.abs(cdDays);
          reason = `Consent deadline expired ${Math.abs(cdDays)} day${Math.abs(cdDays) !== 1 ? 's' : ''} ago — Section 10 needed`;
        } else if (cd && cdDays !== null && cdDays <= 3 && cdDays >= 0 && st !== 'dissent') {
          level = 'amber';
          reason = `Consent deadline in ${cdDays} day${cdDays !== 1 ? 's' : ''}`;
        } else if (st === 'dissent' && !hasSurveyor) {
          level = 'amber';
          reason = `Dissent received — no surveyor appointed yet`;
        } else if (noticed && staleDays !== null && staleDays >= 14) {
          level = 'red'; daysOverdue = staleDays;
          reason = `No progress for ${staleDays} days`;
        } else if (noticed && staleDays !== null && staleDays >= 10) {
          level = 'amber';
          reason = `No progress for ${staleDays} days`;
        }

        // Check for chasing email linked to this AO
        const aoEmail = ao.email || ao.ao_email || '';
        const aoChasing = chasingEmails.find(e =>
          (aoEmail && e.sender_email?.toLowerCase() === aoEmail.toLowerCase()) ||
          e.body_preview?.toLowerCase().includes((aoName || '').toLowerCase().split(' ')[0])
        );
        if (aoChasing && !level) {
          level = 'amber';
          reason = `Unreplied email from ${aoChasing.sender_name || aoChasing.sender_email} — ${daysSince(aoChasing.received_at)}d ago`;
        }

        if (!level) continue; // On track, skip from briefing

        projectHasAction = true;

        aoCards.push({
          aoId: ao.id || ao.num,
          aoNum: ao.num,
          name: aoName,
          address: aoAddress,
          email: ao.email || ao.ao_email || '',
          status: ao.status || '',
          level,
          reason,
          daysOverdue,
          surveyor: surveyorName ? { name: surveyorName, firm: surveyorFirm } : null,
          statusTrack: buildStatusTrack(ao),
          actions: buildActions(ao, level),
          keyDates: {
            consentDeadline: cd || null,
            consentDeadlineDays: cdDays,
            s10Deadline: sd || null,
            s10DeadlineDays: sdDays,
            lastChange: lastChange || null,
            staleDays,
          },
          chasingEmail: aoChasing ? {
            sender: aoChasing.sender_name || aoChasing.sender_email,
            subject: aoChasing.subject,
            preview: aoChasing.body_preview?.slice(0, 120),
            daysAgo: daysSince(aoChasing.received_at),
          } : null,
        });
      }

      // Sort AO cards: red first, then by daysOverdue desc
      aoCards.sort((a, b) => urgencyScore(a.level, a.daysOverdue) - urgencyScore(b.level, b.daysOverdue));

      if (projectHasAction || chasingEmails.length > 0) {
        briefingProjects.push({
          id: project.id,
          ref: project.ref || '',
          address: addr,
          aoCards,
          unrepliedEmails: projectEmails.slice(0, 3).map(e => ({
            id: e.id,
            sender: e.sender_name || e.sender_email,
            subject: e.subject,
            preview: e.body_preview?.slice(0, 100),
            daysAgo: daysSince(e.received_at),
            isChasing: chasingPattern.test(e.subject || '') || chasingPattern.test(e.body_preview || ''),
          })),
          totalAOs: (project.aos || []).length,
          actingAOs: aoCards.length,
        });
      }
    }

    // Sort projects: those with red AOs first
    briefingProjects.sort((a, b) => {
      const aRed = a.aoCards.some(c => c.level === 'red') ? 0 : 1;
      const bRed = b.aoCards.some(c => c.level === 'red') ? 0 : 1;
      return aRed - bRed;
    });

    const totalRed = briefingProjects.reduce((s, p) => s + p.aoCards.filter(c => c.level === 'red').length, 0);
    const totalAmber = briefingProjects.reduce((s, p) => s + p.aoCards.filter(c => c.level === 'amber').length, 0);
    const totalCards = totalRed + totalAmber;

    return res.status(200).json({
      projects: briefingProjects,
      totalCards,
      totalRed,
      totalAmber,
      summary: totalCards === 0
        ? 'All projects on track — nothing urgent today.'
        : `${totalRed > 0 ? `${totalRed} urgent` : ''}${totalRed > 0 && totalAmber > 0 ? ' · ' : ''}${totalAmber > 0 ? `${totalAmber} upcoming` : ''} across ${briefingProjects.length} project${briefingProjects.length !== 1 ? 's' : ''}.`,
    });

  } catch (err) {
    console.error('[briefing] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
