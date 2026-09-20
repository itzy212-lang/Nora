// api/cron-auto-draft.js
// Runs every 15 minutes via Vercel cron.
// Finds new inbound emails that need a draft response and generates them via Ely.

export const config = { maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';

const SKIP_SENDERS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'notifications@', 'mailer@', 'newsletter@', 'updates@',
  'bounce@', 'postmaster@',
  'xero.com', 'invoicereminders@', 'accounting@', 'billing@',
  'sage.com', 'quickbooks', 'hmrc', 'gov.uk',
  'linkedin.com', 'twitter.com', 'facebook.com',
  'google.com', 'microsoft.com', 'apple.com',
];

const SKIP_FOLDERS = ['junk', 'spam', 'deleted', 'trash', 'junkemail'];

function shouldSkip(email) {
  const sender = (email.sender_email || '').toLowerCase();
  const folder = (email.folder || '').toLowerCase();
  if (SKIP_FOLDERS.some(f => folder.includes(f))) return 'junk folder';
  if (SKIP_SENDERS.some(s => sender.includes(s))) return 'automated sender';
  if (email.is_replied) return 'already replied';
  if (email.ai_category === 'spam' || email.ai_category === 'newsletter') return 'spam';
  return null;
}

// Added 2026-09-20 - the full diary-aware auto-send gate, built from
// an extended design conversation. Deliberately a single, self-
// contained function returning {eligible, framing}: `eligible` gates
// whether anything happens this cron cycle at all (drafting AND
// sending both wait behind this - see the caller), `framing` is
// context handed to the drafting prompt so the response itself says
// something true and specific, never generic filler, when it does go
// out. Checked in a fixed priority order, each one a genuinely
// distinct signal, not a fallback chain of guesses:
//
//   1. Holiday - certain, beats everything.
//   2. Today's Schedule of Condition appointments, blanketed as one
//      span (own 90-minute assumed duration, since none is ever
//      recorded; 45 minutes either side for travel) - certain.
//   3. Any other calendar commitment today (meeting/call/site visit/
//      appointment) - certain, but the response never says what kind.
//   4. Outside configured business hours - certain, reads
//      firm_settings.business_hours, never hardcoded.
//   5. Fallback: the 45-minute silence rule - an inference, not a
//      certainty, used only when none of the above apply at all.
//
// Every one of 1-4, when it applies, makes the email eligible
// immediately - there is no reason to wait out silence when a
// stronger, certain signal already answers "is Itzik available"
// definitively. Called fresh every single cron cycle with no memory
// of past calls - the "keep re-asking until something changes"
// design this whole feature depends on comes entirely from there
// being no cached decision anywhere, not from this function itself.
async function computeSendEligibility(email, supabase, ownerUserId) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (!ownerUserId) {
    // Can't check anyone's diary or hours without knowing whose they
    // are - falls through to the silence-only fallback rather than
    // blocking entirely.
    return computeSilenceFallback(email, supabase);
  }

  // ── 1. Holiday ──────────────────────────────────────────────────
  const { data: holidayTasks } = await supabase
    .from('tasks')
    .select('due_date, end_date')
    .eq('user_id', ownerUserId)
    .eq('task_type', 'holiday')
    .lte('due_date', todayStr)
    .order('due_date', { ascending: false })
    .limit(20);

  const activeHoliday = (holidayTasks || []).find(h => todayStr <= (h.end_date || h.due_date));
  if (activeHoliday) {
    const returnDate = new Date((activeHoliday.end_date || activeHoliday.due_date) + 'T00:00:00');
    const returnDateFmt = returnDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    return {
      eligible: true,
      framing: `Itzik is on annual leave until ${returnDateFmt}. He has intermittent access to email while away and will come back to you as soon as he can. Do not state a more specific time than this.`,
    };
  }

  // ── 2. Today's SOC appointments, blanketed ─────────────────────
  const { data: socTasks } = await supabase
    .from('tasks')
    .select('time')
    .eq('user_id', ownerUserId)
    .eq('task_type', 'soc')
    .eq('due_date', todayStr)
    .not('status', 'in', '(cancelled,complete)');

  const socTimes = (socTasks || [])
    .map(t => (t.time || '').match(/^(\d{1,2}):(\d{2})/))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10) * 60 + parseInt(m[2], 10)); // minutes since midnight

  if (socTimes.length) {
    const SOC_DURATION_MIN = 90; // assumed, always - no real duration is ever recorded
    const TRAVEL_BUFFER_MIN = 45;
    const first = Math.min(...socTimes);
    const last = Math.max(...socTimes);
    const blanketStart = first - TRAVEL_BUFFER_MIN;
    const blanketEnd = last + SOC_DURATION_MIN + TRAVEL_BUFFER_MIN;

    if (nowMinutes >= blanketStart && nowMinutes <= blanketEnd) {
      const returnTimeMin = blanketEnd;
      const returnDate = new Date(now);
      returnDate.setHours(0, returnTimeMin, 0, 0);
      const hours = await getBusinessHoursForDate(supabase, returnDate);
      const framing = await buildReturnTimeFraming(returnDate, hours, 'soc');
      return { eligible: true, framing };
    }
  }

  // ── 3. Any other calendar commitment today ─────────────────────
  const OTHER_MEETING_TYPES = ['meeting', 'call', 'site_visit', 'appointment'];
  const { data: otherTasks } = await supabase
    .from('tasks')
    .select('time, task_type')
    .eq('user_id', ownerUserId)
    .in('task_type', OTHER_MEETING_TYPES)
    .eq('due_date', todayStr)
    .not('status', 'in', '(cancelled,complete)');

  const OTHER_MEETING_DURATION_MIN = 60; // assumed default - no end time is ever recorded for these either
  const activeOther = (otherTasks || []).find(t => {
    const m = (t.time || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return false;
    const startMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return nowMinutes >= startMin && nowMinutes <= startMin + OTHER_MEETING_DURATION_MIN;
  });

  if (activeOther) {
    const isCall = activeOther.task_type === 'call';
    return {
      eligible: true,
      framing: isCall
        ? 'Itzik is in a telephone meeting right now. Say Nora will pass this along and he will message back between appointments. Do not describe the call itself.'
        : 'Itzik is in a meeting right now. Say he will call back. Do not describe what kind of meeting.',
    };
  }

  // ── 4. Outside business hours ───────────────────────────────────
  const hoursToday = await getBusinessHoursForDate(supabase, now);
  const isOpenNow = hoursToday && !hoursToday.off && nowMinutes >= toMinutes(hoursToday.open) && nowMinutes < toMinutes(hoursToday.close);
  if (!isOpenNow) {
    const framing = await buildOutOfHoursFraming(supabase, now, ownerUserId);
    return { eligible: true, framing };
  }

  // ── 5. Fallback: silence gate ────────────────────────────────────
  return computeSilenceFallback(email, supabase);
}

function toMinutes(hhmm) {
  const m = (hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}

const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

async function getBusinessHoursForDate(supabase, date) {
  const { data: firmSettings } = await supabase.from('firm_settings').select('business_hours').limit(1).maybeSingle();
  const hours = firmSettings?.business_hours;
  if (!hours) return null;
  return hours[WEEKDAY_KEYS[date.getDay()]] || { off: true };
}

// Builds the "back to you by [time]" framing for the SOC case,
// applying the three-tier hedge established directly on request:
// comfortably before 4pm -> plain; the return time itself falling in
// the 4-5pm window -> hedge that it may slip to tomorrow; past close
// -> state tomorrow plainly, no hedge.
async function buildReturnTimeFraming(returnDate, hoursToday, kind) {
  const closeMin = hoursToday && !hoursToday.off ? toMinutes(hoursToday.close) : 17 * 60;
  const returnMin = returnDate.getHours() * 60 + returnDate.getMinutes();
  const timeStr = returnDate.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });

  const base = kind === 'soc'
    ? 'Itzik is currently out on Schedule of Condition inspections today.'
    : 'Itzik is currently unavailable.';

  if (returnMin > closeMin) {
    return `${base} He will not be back at his desk before the office closes today, so he will most likely come back to you tomorrow instead. Do not imply a same-day gap between appointments if there is more than one today - just say he has site appointments booked in.`;
  }
  if (returnMin >= closeMin - 60) {
    return `${base} He should be back at his desk by around ${timeStr}, though as that's close to the end of the day it may be that he comes back to you tomorrow instead if he doesn't manage it today. Do not imply a same-day gap between appointments if there is more than one today - just say he has site appointments booked in.`;
  }
  return `${base} He should be back to you by around ${timeStr}. Do not imply a same-day gap between appointments if there is more than one today - just say he has site appointments booked in.`;
}

// Out-of-hours framing: today closed/finished, or hasn't opened yet -
// find the next day the office is actually open, and if that
// reopening day itself has SOC/meeting commitments already booked
// first thing, mention that too rather than implying full
// availability the moment the office opens.
async function buildOutOfHoursFraming(supabase, now, ownerUserId) {
  const { data: firmSettings } = await supabase.from('firm_settings').select('business_hours').limit(1).maybeSingle();
  const hours = firmSettings?.business_hours;

  let checkDate = new Date(now);
  let daysAhead = 0;
  let nextOpenDay = null;
  while (daysAhead < 8) {
    const dayHours = hours ? hours[WEEKDAY_KEYS[checkDate.getDay()]] : null;
    const isToday = daysAhead === 0;
    const todayStillOpen = isToday && dayHours && !dayHours.off && (now.getHours() * 60 + now.getMinutes()) < toMinutes(dayHours.close);
    if (dayHours && !dayHours.off && !todayStillOpen) {
      nextOpenDay = { date: new Date(checkDate), hours: dayHours };
      break;
    }
    checkDate.setDate(checkDate.getDate() + 1);
    daysAhead++;
  }

  if (!nextOpenDay) {
    return 'The office is currently closed. Itzik will come back to you as soon as he is back in the office.';
  }

  const dayLabel = daysAhead <= 1 ? 'tomorrow' : nextOpenDay.date.toLocaleDateString('en-GB', { weekday: 'long' });
  let framing = `This email arrived outside office hours. The office is next open ${dayLabel}, from ${nextOpenDay.hours.open}. Itzik will come back to you then.`;

  if (ownerUserId) {
    const nextOpenDateStr = nextOpenDay.date.toISOString().slice(0, 10);
    const { data: nextDaySocs } = await supabase
      .from('tasks')
      .select('id')
      .eq('user_id', ownerUserId)
      .eq('task_type', 'soc')
      .eq('due_date', nextOpenDateStr)
      .limit(1);
    if (nextDaySocs?.length) {
      framing += ' He does have site appointments booked in that day too, so it may take him a little longer to get back to you once the office reopens.';
    }
  }

  return framing;
}

// The original, pre-diary design - the only fallback once nothing
// certain (holiday/SOC/meeting/hours) applies. Reference point is
// whichever is more recent: the email's own arrival, or the user's
// last message in this thread - fixed 2026-09-20 after finding the
// original version had no real minimum wait for a never-replied
// thread at all.
async function computeSilenceFallback(email, supabase) {
  if (!email.thread_id) return { eligible: false, framing: null };

  const { data: lastOutgoing } = await supabase
    .from('emails')
    .select('received_at, sent_at')
    .eq('thread_id', email.thread_id)
    .or('direction.eq.outgoing,is_sent.eq.true')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastOwnMessageAt = lastOutgoing ? (lastOutgoing.sent_at || lastOutgoing.received_at) : null;
  const referenceTime = Math.max(
    new Date(email.received_at).getTime(),
    lastOwnMessageAt ? new Date(lastOwnMessageAt).getTime() : 0
  );
  const minutesSinceReference = (Date.now() - referenceTime) / (1000 * 60);

  // On request: no diary signal at all -> keep this deliberately
  // vague, no time estimate, since there is nothing real to base one
  // on.
  return {
    eligible: minutesSinceReference >= 45,
    framing: null,
  };
}

export default async function handler(req, res) {
  // Fixed 2026-08-14: the x-vercel-cron header this checked for doesn't
  // exist in real Vercel invocations (confirmed against current Vercel
  // docs and a real production log). This endpoint only ever survived
  // via its user-agent fallback below — real, but spoofable, since
  // anyone can set a custom user-agent. Added the actual documented
  // mechanism (Authorization: Bearer CRON_SECRET) as the primary check;
  // kept the user-agent fallback for defense-in-depth, same as before.
  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}` || (req.method === 'GET' && req.headers['user-agent']?.includes('vercel-cron'));
  const isManual = req.method === 'POST' && req.headers['x-nora-manual'] === 'true';
  if (!isCron && !isManual) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const openaiKey = process.env.OPENAI_API_KEY;

  // Added 2026-09-20, on request: nora_auto_send previously existed
  // as a Settings toggle (firm_settings.nora_auto_send) but was never
  // read anywhere in the backend - confirmed directly, zero matches
  // across api/*.js before this change. Fetched once per run, not
  // per-email, since it's a single global firm-level setting (this
  // account currently has exactly one firm_settings row).
  let autoSendEnabled = false;
  try {
    const { data: firmSettings } = await supabase.from('firm_settings').select('nora_auto_send').limit(1).maybeSingle();
    autoSendEnabled = !!firmSettings?.nora_auto_send;
  } catch (e) {
    console.warn('[cron-auto-draft] Could not read nora_auto_send setting, defaulting to off:', e.message);
  }

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: emails, error } = await supabase
      .from('emails')
      .select('id, subject, body, sender_email, sender_name, received_at, project_id, folder, is_replied, ai_category, thread_id, direction, user_id')
      .eq('direction', 'incoming')
      .eq('is_draft', false)
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    // Fixed 2026-09-17, real, confirmed bug — flagged explicitly in
    // the to-do list handoff brief as a known, not-yet-fixed gap: the
    // follow-up reminder task below hardcoded user_id to Itzik's own
    // UUID unconditionally, regardless of whose inbox the email
    // actually arrived in. For a single-user account this was
    // invisible; for a second real user, every one of their AI
    // holding-reply follow-ups would land in Itzik's to-do list
    // instead of their own.
    //
    // emails.user_id is stored inconsistently across accounts — some
    // rows hold the real auth UUID, others hold the plain email
    // address (confirmed directly: help@sq1consulting.co.uk's own
    // emails store the email string, not its UUID) — so it can't be
    // used as tasks.user_id (a UUID column) as-is. auth.users is the
    // one reliable source mapping either form to the real UUID,
    // checked directly against both real accounts before writing
    // this. Resolved once per run via the admin API (small, fixed
    // number of real users — a full listUsers() and cache is simpler
    // and more robust here than trying to guess which columns are
    // safe to query directly across every account's differently-shaped
    // rows) rather than once per email.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ownerIdCache = new Map();
    let authUsersList = null;
    async function resolveOwnerUserId(rawUserId) {
      if (!rawUserId) return null;
      if (UUID_RE.test(rawUserId)) return rawUserId;
      if (ownerIdCache.has(rawUserId)) return ownerIdCache.get(rawUserId);
      if (!authUsersList) {
        const { data, error: listErr } = await supabase.auth.admin.listUsers();
        if (listErr) { console.warn('[cron-auto-draft] Could not list users to resolve owner:', listErr.message); return null; }
        authUsersList = data?.users || [];
      }
      const match = authUsersList.find(u => (u.email || '').toLowerCase() === rawUserId.toLowerCase());
      const resolved = match?.id || null;
      ownerIdCache.set(rawUserId, resolved);
      return resolved;
    }

    const results = { processed: 0, skipped: 0, drafted: 0, errors: 0 };

    for (const email of emails || []) {
      const { data: existing } = await supabase
        .from('email_auto_drafts')
        .select('id')
        .eq('email_id', email.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (existing) { results.skipped++; continue; }

      const skipReason = shouldSkip(email);
      if (skipReason) { results.skipped++; continue; }

      // Added 2026-09-20, on request: ai_category existed as a column
      // and was already referenced by shouldSkip() above, but nothing
      // ever populated it - confirmed directly against real data,
      // 2,629 of 2,629 incoming Outlook emails had ai_category=null.
      // That check was dead code. This is a genuine classification
      // pass, cheap/fast tier (Luna), run before any thread/project
      // context is loaded so a marketing email doesn't pay for that
      // work at all. Only skips on a confident classification -
      // anything the model itself is unsure about is left to draft
      // normally rather than risk silently dropping something real.
      let emailCategory = null;
      try {
        const classifyRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-5.6-luna',
            max_completion_tokens: 60,
            messages: [
              { role: 'developer', content: 'Classify this email for a Party Wall surveying practice. Respond with valid JSON only: {"category": "business"|"marketing", "confident": true|false}. "business" means genuine correspondence related to a project, a party wall matter, a surveyor, an adjoining/building owner, an invoice/payment for real work, or similar. "marketing" means sales outreach, promotional content, newsletters, or cold pitches unrelated to an actual matter this practice is handling. If genuinely unsure, set confident to false.' },
              { role: 'user', content: 'FROM: ' + (email.sender_name || email.sender_email) + '\nSUBJECT: ' + (email.subject || '') + '\nBODY: ' + (email.body || '').slice(0, 800) },
            ],
          }),
        });
        if (classifyRes.ok) {
          const classifyData = await classifyRes.json();
          const parsed = JSON.parse((classifyData.choices?.[0]?.message?.content || '{}').replace(/```json|```/g, '').trim());
          if (parsed.confident) emailCategory = parsed.category;
        }
      } catch (classifyErr) {
        console.warn('[cron-auto-draft] Classification failed for', email.id, '- proceeding to draft as normal:', classifyErr.message);
      }

      if (emailCategory) {
        // Fixed: .catch() chained directly on a Supabase query builder
        // is not reliably supported in this environment - confirmed
        // live, this exact line was throwing "TypeError: ...catch is
        // not a function" and crashing the ENTIRE cron run (HTTP 500)
        // on every single invocation since deployment, not just
        // skipping this one email. A proper try/catch is the only
        // safe pattern here.
        try {
          await supabase.from('emails').update({ ai_category: emailCategory }).eq('id', email.id);
        } catch (e) {
          console.warn('[cron-auto-draft] ai_category update failed:', e.message);
        }
      }

      if (emailCategory === 'marketing') {
        results.skipped++;
        continue;
      }

      // Added 2026-09-20: the eligibility gate now runs BEFORE
      // drafting, not after - on request, so that "not eligible yet"
      // simply means nothing happens this cycle at all, and the very
      // next cron run asks the same fresh question with no memory of
      // this attempt. This replaces drafting-always-then-deciding-
      // whether-to-send; while nora_auto_draft/nora_auto_send are
      // both still being trialled, this does mean no draft exists to
      // review during an active conversation or outside the
      // eligibility window - only once a response is actually going
      // out is anything created.
      const ownerUserId = await resolveOwnerUserId(email.user_id);
      const eligibility = await computeSendEligibility(email, supabase, ownerUserId);
      if (!eligibility.eligible) {
        results.skipped++;
        continue;
      }

      results.processed++;

      try {
        let projectContext = '';

        // Always load thread history — regardless of project link
        if (email.thread_id) {
          const { data: thread } = await supabase
            .from('emails')
            .select('sender_email, sender_name, body, direction, received_at')
            .eq('thread_id', email.thread_id)
            .neq('id', email.id)
            .order('received_at', { ascending: true })
            .limit(10);

          if (thread?.length) {
            const threadText = thread.map(t =>
              '[' + (t.direction === 'incoming' ? 'FROM: ' + (t.sender_name || t.sender_email) : 'FROM ITZIK:') + ']\n' + (t.body || '').slice(0, 500)
            ).join('\n\n---\n\n');
            projectContext = 'THREAD HISTORY (oldest first):\n' + threadText;
          }
        }

        // Also load project context if linked
        let projectAOs = [];
        let projectTasksForDrafting = [];
        let projectDocumentsForDrafting = [];
        let existingCalendarEvents = [];
        if (email.project_id) {
          const { data: project } = await supabase
            .from('projects')
            .select('ref, bo_address, bo_names, proposed_works, status')
            .eq('id', email.project_id)
            .single();
          if (project) {
            projectContext = 'PROJECT: Ref ' + project.ref + ' | ' + project.bo_address + ' | Building Owner: ' + project.bo_names + ' | Works: ' + (project.proposed_works || 'not specified') + '\n\n' + projectContext;
          }

          // Added 2026-09-12, on request, built into the correct
          // system this time (the assistant reply, not Draft with
          // Nora): this had no access to adjoining owners, scheduled
          // tasks, or saved documents at all — so a factual question
          // like "when is the Schedule of Condition booked" or "have
          // the drawings been received" could never be answered
          // accurately, only guessed at generically.
          // Fixed 2026-09-12, real, confirmed gap found while
          // discussing this directly: only name/address were fetched
          // — nothing about actual status (dissent/consent, notice
          // served, S10 served/expired, own surveyor appointed, SOC
          // booked, award served) was available at all, so a genuine
          // "where are we at" status question could never get a real
          // answer, only a generic acknowledgement.
          const { data: aos } = await supabase
            .from('adjoining_owners')
            .select('id, name, address, status, notice_served_date, s10_served_date, s10_deadline, consent_deadline, agreed_surveyor, award_served_date, s104b_served_date, soc_agreed_date, soc_status')
            .eq('project_id', email.project_id);
          projectAOs = aos || [];
          if (projectAOs.length) {
            const today = new Date();
            projectContext += '\n\nADJOINING OWNER STATUS ON THIS PROJECT (' + projectAOs.length + '):\n' +
              projectAOs.map(a => {
                const parts = [a.name || 'Unknown', a.address ? '(' + a.address + ')' : null, 'status: ' + (a.status || 'not yet actioned')];
                if (a.notice_served_date) parts.push('notice served ' + a.notice_served_date);
                if (a.consent_deadline) {
                  const overdueDays = Math.floor((today - new Date(a.consent_deadline)) / 86400000);
                  parts.push('consent deadline ' + a.consent_deadline + (overdueDays > 0 ? ' (' + overdueDays + ' days overdue)' : ''));
                }
                if (a.s10_served_date) parts.push('S10 served ' + a.s10_served_date);
                if (a.s10_deadline) {
                  const s10OverdueDays = Math.floor((today - new Date(a.s10_deadline)) / 86400000);
                  parts.push('S10 deadline ' + a.s10_deadline + (s10OverdueDays > 0 ? ' (expired ' + s10OverdueDays + ' days ago — eligible for a Section 10(4)(b) appointment if no response)' : ''));
                }
                // Fixed 2026-09-13: agreed_surveyor being true means
                // Itzik himself is acting as the agreed surveyor for
                // this AO — not that the AO has appointed their own,
                // separate one. Getting this backwards would have
                // produced a misleading status summary. Also on
                // request: never name a separate surveyor, only that
                // one exists.
                if (a.agreed_surveyor) parts.push('Itzik is acting as their agreed surveyor');
                else if ((a.status || '').toLowerCase() === 'dissent') parts.push('they have appointed their own surveyor');
                if (a.soc_agreed_date) parts.push('Schedule of Condition booked for ' + a.soc_agreed_date);
                else if (a.status && a.status.toLowerCase() !== 'notice_served' && !a.consent_deadline) parts.push('no Schedule of Condition booked yet');
                if (a.s104b_served_date) parts.push('10(4)(b) served ' + a.s104b_served_date);
                if (a.award_served_date) parts.push('award served ' + a.award_served_date);
                return '- ' + parts.filter(Boolean).join(', ');
              }).join('\n');
          }

          const { data: tasks } = await supabase
            .from('tasks')
            .select('id, title, task_type, due_date, time, status, ao_id, ao_address_snapshot')
            .eq('project_id', email.project_id)
            .order('due_date', { ascending: true })
            .limit(30);
          projectTasksForDrafting = tasks || [];
          if (projectTasksForDrafting.length) {
            projectContext += '\n\nSCHEDULED TASKS ON THIS PROJECT (' + projectTasksForDrafting.length + '):\n' +
              projectTasksForDrafting.map(t => {
                const when = t.due_date ? t.due_date + (t.time ? ' at ' + t.time : ' (no specific time set)') : 'no date set';
                return '- ' + (t.title || t.task_type || 'Task') + ': ' + when + ' — status: ' + (t.status || 'open') + (t.ao_address_snapshot ? ' — AO: ' + t.ao_address_snapshot : '');
              }).join('\n');
          }

          const { data: documents } = await supabase
            .from('documents')
            .select('id, file_name, category, section_type, created_at')
            .eq('project_id', email.project_id)
            .order('created_at', { ascending: false })
            .limit(30);
          projectDocumentsForDrafting = documents || [];
          if (projectDocumentsForDrafting.length) {
            projectContext += '\n\nDOCUMENTS SAVED ON THIS PROJECT (' + projectDocumentsForDrafting.length + '):\n' +
              projectDocumentsForDrafting.map(d => '- ' + (d.file_name || 'file') + (d.category ? ' (' + d.category + ')' : '')).join('\n');
          }

          // Existing calendar events on this project — used below for
          // conflict-checking before a new time gets proposed/confirmed.
          const { data: calEvents } = await supabase
            .from('calendar_events')
            .select('title, start_time, end_time')
            .eq('project_id', email.project_id)
            .gte('start_time', new Date().toISOString());
          existingCalendarEvents = calEvents || [];
          if (existingCalendarEvents.length) {
            projectContext += '\n\nEXISTING CALENDAR COMMITMENTS ON THIS PROJECT (upcoming, with real duration):\n' +
              existingCalendarEvents.map(e => {
                const start = new Date(e.start_time);
                const end = new Date(e.end_time);
                return '- ' + (e.title || 'Appointment') + ': ' + start.toLocaleDateString('en-GB') + ' ' + start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' to ' + end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
              }).join('\n');
          }
        }

        // Nora autonomous draft brain
        const NORA_DRAFT_BRAIN = `You are Nora, an AI practice assistant for Square One Consulting, a party wall surveying firm run by Itzik Darel ACIArb MIPWS.

YOUR ROLE:
You respond to incoming emails autonomously on behalf of Itzik Darel. Depending on his settings, some of your drafts are reviewed by him before sending, and others go out automatically the moment you produce them — you cannot tell which applies to any given draft, so write every single one as though it might be sent exactly as written, with no human check afterward. Never write a rough placeholder assuming someone will tidy it up.

YOUR CORE RESPONSIBILITIES:
1. Read the email and the thread history carefully before drafting anything.
2. If the email is linked to a project, check the project context provided and use it to give a specific, informed response.
3. Draft a professional, concise response in Itzik's voice.

WHAT YOU CAN DO:
- Acknowledge receipt of emails and confirm information has been noted
- Provide project status updates based on the data provided (notices served, dates, AO responses, surveyor appointments)
- Answer factual questions where the answer is in the project data
- Request further information or documents when relevant
- Confirm that matters are in hand or being progressed
- Advise on next steps under the Party Wall Act where the situation is clear from the data

FACTUAL RESOLUTION — check the actual project data provided above before drafting a generic acknowledgement:
- A scheduled-date question (e.g. when is the Schedule of Condition, when is the inspection): check the scheduled tasks given above, if any exist. If a real date is found, state it precisely and factually — name the actual date and time, and which adjoining owner it is for if there is more than one on this project. If nothing relevant is found in the data provided, this does NOT mean nothing is booked — it may simply not be recorded here. Never state or imply that nothing is booked or scheduled. Instead, respond as Nora's own limited visibility: along the lines of "I do not seem to have access to his diary for this at the moment — I will find out and make sure he comes back to you to confirm" — calm, non-alarming, never a confident negative claim.
- A document/drawing status question (e.g. have the drawings been received, are you still waiting on X): check the saved documents given above, if any exist. If the document appears to be there, confirm receipt factually by name. If not, check the thread history for whether this was genuinely requested — if a request is confirmed there, say so factually (e.g. "I can see this was requested from the structural engineer — not yet received, we will keep you posted"). If there is no confirmation either way, use the same cautious, non-alarming framing as the date case above.
- If, and only if, this cautious framing was used anywhere in the draft, end the draft on its own final line with the exact marker <<<NEEDS_FOLLOWUP>>> — this is a signal for the app to remind Itzik to actually go check and confirm. Omit it entirely for any other kind of reply, including a factual answer that did find real data.

GENERAL STATUS UPDATE REQUESTS (e.g. "where are we at", "can you update me on progress"): when asked for an overall project update rather than one specific fact, use the ADJOINING OWNER STATUS data above to give a real, per-AO summary rather than a vague "things are progressing" acknowledgement. Refer to each AO by street number rather than their full name/address unless the recipient is that specific AO or their surveyor (e.g. "the neighbour at number 80" is enough). For each AO, describe their actual current position in plain terms — dissented and appointed their own surveyor, consented, notice served and awaiting response, Schedule of Condition booked or not yet booked, award served. If an AO's Section 10 deadline has expired with no response, say so plainly, and if the recipient of this email is the one who'd need to confirm the next step (most likely the Building Owner asking for an update), ask naturally whether they're happy to proceed under Section 10(4)(b) if nothing further is received. If nothing in the data confirms a particular AO's position clearly, use the same cautious "I don't have full visibility on that one" framing rather than guessing.

WHAT YOU MUST NEVER DO:
- Propose new meeting times or dates that Itzik has not already offered in the thread. If a meeting time is being proposed for the first time by the other party and Itzik has not offered availability, say Itzik will be in touch to confirm a suitable time
- Commit to any deadline or timeframe not already established in the project data
- Invent project details, notice dates, fees, surveyor names or any other facts not provided to you
- Give legal advice or make legal determinations
- Agree to fee reductions or variations without instruction
- Make promises on behalf of Itzik that he has not authorised

PROPOSED (NOT YET CONFIRMED) TIME — CHECK AVAILABILITY FIRST:
If an AVAILABILITY CONTEXT block has been provided separately below, that is the authoritative answer — it is computed directly from the real diary and business hours, not a guess. Use the time and framing it gives you exactly; do not recalculate your own window when it's present. Only use the method below when no AVAILABILITY CONTEXT has been provided for this email at all.

If the other party is asking for or proposing a specific time or day (not yet agreed by Itzik) and existing calendar commitments are provided above, check whether that day already has appointments:
- If nothing is booked that day in the data provided, this doesn't confirm Itzik is free — never say he's available, open, or free that day. Say something along the lines of "I can't seem to see anything in his diary for that day — let me come back to you and confirm" — Nora's own limited visibility, same cautious framing as the FACTUAL RESOLUTION rule above.
- If the day already has other appointments and the request is for an in-person meeting or something that would need real, blocked-out time, acknowledge this naturally rather than pretending the diary is empty — e.g. "I can see he has a couple of appointments booked in that day, but I'll make sure he reaches out to you between them" — honest, not a confident commitment to an exact free slot you can't actually confirm.
- If the day has appointments but the request is specifically for a phone call, you can be more genuinely useful: work out a real window using the actual end time of the last relevant appointment from the data provided, plus a two-hour buffer after it, and offer that window (e.g. an appointment ending at 11:00 → offer "he'll call you sometime between 1 and 2" or similar, not a single fixed minute — a short window is safer than a precise promise). Only do this when you can calculate it from real end times in the data provided; if the data doesn't give a clear end time to calculate from, fall back to the cautious framing above rather than guessing a buffer from nothing.

CONFIRMED APPOINTMENTS — SPECIAL RULE:
If the thread shows that a specific call or meeting time has been confirmed (either Itzik offered it and they accepted, or they proposed a time and it was agreed), you should:
1. Acknowledge it warmly — e.g. "Thank you for confirming — I will make sure Itzik is aware that you will be calling at 10:30 tomorrow."
2. Note that it has been added to the diary — e.g. "I have added this to the diary."
3. Keep it short — 2-3 sentences maximum.
Do NOT say "Itzik will be in touch to confirm a suitable time" when the time is already confirmed in the thread.

WHAT ITZIK IS ACTUALLY DOING — NEVER REVEAL DETAIL:
If an AVAILABILITY CONTEXT block says Itzik is on a Schedule of Condition inspection, you may say exactly that — it's specific, real information a sender should have. For anything else (a meeting, a call, an appointment), never say what kind — "in a meeting" or "in a telephone meeting" only, regardless of what the underlying task is actually called or what the thread might suggest. If Itzik has more than one Schedule of Condition booked on the same day, describe it as one continuous block of site appointments — never state or imply a gap between them, even where one technically exists between the actual times.

ANSWERABLE VS. NEEDS-ITZIK — HANDLE BOTH IN ONE REPLY:
An email can contain more than one kind of question. Answer the parts you can answer directly and confidently from the real project/AO data provided — a status update, a scheduled date, a document received — as a plain, complete answer, with no holding language at all for that part. For any remaining part that genuinely needs Itzik's personal judgement or isn't answerable from the data given, add the appropriate holding language (using the AVAILABILITY CONTEXT if one is provided) only for that part. Don't force a whole email into one mode or the other — a message can be answered and held in the same reply, and should read as one coherent response, not two disconnected halves.

FIRST PERSON RULES — CRITICAL:
You are Nora, writing on behalf of Itzik Darel. Before using "I" in any sentence, ask yourself: is this something Nora is actually doing, or is it something Itzik has done?

YOU CAN say "I" for things Nora is doing right now:
- "I am writing to..." / "I am passing on..." / "I am following up..."
- "I will make sure Itzik is aware..." / "I will pass this on..."
- "I will get back to you..." (when Nora is the one following up)

YOU MUST NOT say "I" for things Itzik has done or is doing:
- Itzik has spoken to someone → "Itzik has been in discussion with..." NOT "I have been speaking with..."
- Itzik has served a notice → "the notice has been served" NOT "I have served..."
- Itzik attended an inspection → "Itzik attended the inspection" NOT "I attended..."
- Itzik has reviewed something → "Itzik has reviewed..." NOT "I have reviewed..."
- Itzik received a call → "Itzik received your call" NOT "I received your call..."

The test: if Nora physically cannot have done it, she cannot say "I" did it.

SIGN OFF:
Always end with:
Kind regards,
Nora
On behalf of Itzik Darel
help@sq1consulting.co.uk

TONE:
Professional, warm, concise. Write as Itzik would — not overly formal, not casual. 2-4 short paragraphs maximum unless the subject genuinely requires more.

THREAD COMPLIANCE:
Read the full thread before drafting. Do not re-agree things already established. Do not suggest options already ruled out. Pick up the conversation where it left off.

SURVEYOR NAMES — STRICTLY NO NAMING:
Never name an adjoining owner's own appointed surveyor in a draft, even if the name appears in the project data or thread history provided. If they have appointed their own surveyor, say only that — "they have appointed their own surveyor" — never the surveyor's name or firm. This applies regardless of who the draft is going to.

AMBIGUOUS RESPONSE OPTIONS — CONSENT/DISSENT:
A party wall notice response has four distinct options: consent without a Schedule of Condition, consent subject to a Schedule of Condition, dissent and appoint their own surveyor, or dissent and appoint the agreed surveyor. If an adjoining owner's reply only narrows this down partially — e.g. they say "I consent" or "I'm happy to consent" without specifying which of the two consent options, or they sign an acknowledgement form without indicating an option at all — thank them for their email, then ask directly which of the two consent options they'd like before confirming: consenting outright, or consenting subject to a Schedule of Condition. Briefly explain what a Schedule of Condition actually is, in case they're not familiar with it — in your own natural words, cover: it's a condition report/survey of their property carried out before the works begin, so there's a clear record of its condition beforehand and no dispute later about whether the works caused any damage; the photos and report are then kept on file, and can be used as evidence if any issues do arise once works are underway or afterward. Make clear that either option leaves them fully protected under the Party Wall etc. Act 1996 — a Schedule of Condition is a recommended practical safeguard, not a legal requirement for their protection. Keep the whole thing natural and concise, not a lecture.

PARTY WALL COST QUERIES:
If the Adjoining Owner refers to costs being covered by the contractor, builder, or neighbor, they almost certainly mean the party wall surveyor's fees. In this context confirm clearly: under the Party Wall etc. Act 1996, the Building Owner is responsible for the reasonable costs of the appointed surveyors. Do not ask them to clarify what they mean by costs — assume they mean surveyor's fees and confirm it directly and plainly.

EXPLAINING THE PROCESS — "WHAT HAPPENS NEXT" / "HOW DOES THIS WORK":
When someone emails asking what the process actually is (how party wall notices work, what happens after a notice is served, what their options are), read the thread for context first, then explain the process in full, in this order:

1. A party wall notice is served on the Adjoining Owner. The notice gives four possible responses:
   - Consent, with no further action needed.
   - Consent, subject to a Schedule of Condition being carried out on their property first.
   - Dissent, and appoint Itzik as the "agreed surveyor" acting for both parties.
   - Dissent, and appoint their own separate surveyor. In this case, the Building Owner is responsible for both Itzik's fees and the reasonable fees of the Adjoining Owner's own appointed surveyor.
2. Do not state any fee figures, quotes, or pricing at this stage, under any circumstances. End this part of the explanation by saying Itzik will come back to them directly with pricing.
3. Timescales: the Adjoining Owner has 14 days to respond to the notice. If nothing is heard within that time, a Section 10 notice is served, giving a further 10 days to either appoint Itzik as the agreed surveyor, or appoint their own surveyor.
4. If the Adjoining Owner does neither within that further 10 days, the practice will appoint a surveyor on their behalf. Always include this specific clarification when explaining that step: this appointed surveyor cannot be Itzik — an agreed surveyor has to be agreed between both parties, and in the absence of agreement under Section 10, a separate surveyor is appointed specifically to act for the Adjoining Owner. Itzik can suggest someone the practice has worked with before whose fees are reasonable, and the two surveyors then work together to get the award finalised.

Explain this warmly and in plain language, not as a dense legal recitation — this is someone trying to understand what they're being asked to do, not reading a statute.

PARTY WALL CONTEXT — GENERAL:
Itzik Darel is primarily a party wall surveyor but also handles general construction consultancy. Do not assume every email is party wall related. Read the email and thread carefully — if it is clearly about party wall matters, use your knowledge of the Party Wall etc. Act 1996 to respond accurately. If it is about something else (construction disputes, general surveying, CDM, building contracts), respond appropriately to that context instead. If the context is unclear or there is no project data available, give a professional acknowledgement and say Itzik will be in touch to discuss further — do not guess or assume what the matter relates to.`;

        const userPrompt = 'FROM: ' + (email.sender_name || email.sender_email) +
          '\nSUBJECT: ' + email.subject +
          '\nEMAIL BODY:\n' + (email.body || '').slice(0, 2500) +
          (projectContext ? '\n\n' + projectContext : '') +
          (eligibility.framing ? '\n\nAVAILABILITY CONTEXT (weave this into the reply naturally - this is why a response is going out now rather than Itzik replying personally):\n' + eligibility.framing : '');

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-5.6-terra',
            // Fixed: confirmed live, a real draft attempt failed with
            // "Empty draft" - gpt-5.6-terra is a reasoning model, and
            // internal reasoning tokens count against the same budget
            // as the visible reply text. 600 was already tight for
            // that combined budget, and the brain prompt has grown
            // substantially tonight (diary/availability logic, the new
            // process-explanation section) - genuinely more for the
            // model to reason through before writing anything visible.
            // Every other gpt-5.6-terra drafting call in this codebase
            // already uses 2000-4000; 600 was a real outlier, not a
            // deliberate choice.
            max_completion_tokens: 2000,
            messages: [
              { role: 'developer', content: NORA_DRAFT_BRAIN },
              { role: 'user', content: userPrompt },
            ],
          }),
        });

        if (!response.ok) throw new Error('OpenAI ' + response.status);
        const aiData = await response.json();
        const rawDraftBody = aiData.choices?.[0]?.message?.content || '';
        if (!rawDraftBody) throw new Error('Empty draft');

        // Fixed 2026-09-12: the <<<NEEDS_FOLLOWUP>>> marker must never
        // reach the actual saved draft — it would show up in the
        // email text itself, and get sent to the recipient if used
        // as-is. Detected here, then stripped before saving; the
        // reminder-creation check below uses this same boolean.
        const draftNeedsFollowup = rawDraftBody.includes('<<<NEEDS_FOLLOWUP>>>');
        const draftBody = rawDraftBody.replace('<<<NEEDS_FOLLOWUP>>>', '').trim();

        const { data: savedDraft, error: saveError } = await supabase.from('email_auto_drafts').insert({
          email_id: email.id,
          project_id: email.project_id || null,
          thread_id: email.thread_id || null,
          subject: 'Re: ' + (email.subject || ''),
          body: draftBody,
          to_email: email.sender_email,
          to_name: email.sender_name,
          status: 'pending',
          generated_by: 'cron-auto-draft',
          model: 'gpt-5.6-terra',
        }).select('id').single();

        if (saveError) throw saveError;

        // Detect confirmed appointment and book calendar event
        try {
          const appointmentRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-5.6-luna',
              max_completion_tokens: 200,
              messages: [
                // Fixed 2026-09-12, on request: "if it's not a specific
                // time, it's just a loose appointment... make it an
                // all-day appointment... if it's for a specific time,
                // allocate it — minimum should be half an hour."
                // Previously this only ever extracted a fully-confirmed
                // date+time together — a loose "he'll call you Monday"
                // commitment with no specific time was never captured
                // at all, since the model had no way to say "confirmed,
                // but no time".
                { role: 'developer', content: 'You extract confirmed appointment commitments from email threads. Respond only with valid JSON or null. If a day or a call/meeting has genuinely been committed to in the thread (not just proposed and left open), return: {"confirmed": true, "date": "YYYY-MM-DD", "time": "HH:MM or null if no specific time was actually agreed", "duration_minutes": 30, "title": "Call with [name]", "description": "brief context"}. duration_minutes should reflect the real, stated length if one was given in the thread, and default to 30 (the minimum) if only a specific time was agreed with no stated length — never below 30. If no specific time was agreed at all, set time to null; do not invent one. If nothing has genuinely been committed to, return: {"confirmed": false}. Today is ' + new Date().toISOString().split('T')[0] + '.' },
                { role: 'user', content: 'EMAIL FROM: ' + (email.sender_name || email.sender_email) + '\nSUBJECT: ' + email.subject + '\nBODY: ' + (email.body || '').slice(0, 1000) + '\n\n' + (projectContext || '') },
              ],
            }),
          });

          if (appointmentRes.ok) {
            const apptData = await appointmentRes.json();
            const apptText = apptData.choices?.[0]?.message?.content || '';
            const appt = JSON.parse(apptText.replace(/```json|```/g, '').trim());

            if (appt?.confirmed && appt.date) {
              const hasSpecificTime = !!(appt.time && appt.time !== 'null');
              let startDt, endDt, isAllDay;

              if (hasSpecificTime) {
                // A genuine, specific time was agreed — real timed slot,
                // half an hour minimum even if nothing more specific
                // was stated.
                startDt = new Date(appt.date + 'T' + appt.time + ':00');
                const durationMinutes = Math.max(30, appt.duration_minutes || 30);
                endDt = new Date(startDt.getTime() + durationMinutes * 60000);
                isAllDay = false;
              } else {
                // Loose commitment, no specific time — all-day entry
                // for that date, not tied to a slot that was never
                // actually agreed.
                startDt = new Date(appt.date + 'T00:00:00');
                endDt = new Date(appt.date + 'T23:59:59');
                isAllDay = true;
              }

              // Save to calendar_events table for Nora to display.
              // Fixed: .catch() chained directly on a Supabase query
              // builder is not reliably supported here - this was
              // already inside an outer try/catch so it wasn't
              // crashing the whole run, but it would have surfaced as
              // a misleading generic "Calendar detection failed"
              // rather than the real error. Letting it propagate to
              // that existing outer catch is simplest and correct.
              await supabase.from('calendar_events').insert({
                title: appt.title || 'Call with ' + (email.sender_name || email.sender_email),
                description: (appt.description || 'Auto-booked from email: ' + email.subject) + (isAllDay ? ' (no specific time agreed)' : ''),
                start_time: startDt.toISOString(),
                end_time: endDt.toISOString(),
                source: 'nora_auto_draft',
                email_id: email.id,
                project_id: email.project_id || null,
                created_by: 'cron-auto-draft',
              });

              console.log('[cron-auto-draft] Booked calendar event:', appt.title, appt.date, hasSpecificTime ? appt.time : '(all-day, no specific time)');
            }
          }
        } catch (calErr) {
          console.warn('[cron-auto-draft] Calendar detection failed:', calErr.message);
        }

        // Added 2026-09-12, on request: when the draft used the
        // cautious "I don't have visibility" framing, create a
        // reminder for Itzik to actually go check and confirm — for
        // today and tomorrow, so there are two real chances to see
        // it, rather than relying on him remembering unprompted.
        if (draftNeedsFollowup) {
          try {
            if (!ownerUserId) {
              console.warn('[cron-auto-draft] Could not resolve owner for email', email.id, '— skipping follow-up reminder rather than guessing.');
            } else {
              const today = new Date();
              const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
              const reminderTitle = 'Follow up: ' + (email.subject || 'email reply awaiting confirmation');
              for (const day of [today, tomorrow]) {
                const dateStr = day.toISOString().split('T')[0];
                await supabase.from('tasks').insert({
                  title: reminderTitle,
                  description: 'Nora sent a holding reply that needs a real follow-up — confirm the details and get back to them.',
                  due_date: dateStr,
                  // Fixed 2026-09-13, on request: task_type now uses the
                  // real to-do list categorisation (email/call/
                  // correspondence, not a one-off 'follow_up' type) so
                  // this shows up correctly in the to-do list. source:
                  // 'assistant' marks it as AI-generated for the
                  // green-text distinction agreed on.
                  task_type: 'email',
                  source: 'assistant',
                  status: 'open',
                  project_id: email.project_id || null,
                  linked_email_message_id: email.id,
                  user_id: ownerUserId,
                });
              }
              console.log('[cron-auto-draft] Created follow-up reminders for', email.id, '-> owner', ownerUserId);
            }
          } catch (reminderErr) {
            console.warn('[cron-auto-draft] Follow-up reminder creation failed:', reminderErr.message);
          }
        }

        // ── AUTO-SEND ──────────────────────────────────────────────
        // The eligibility gate has already run, before drafting even
        // started (see above) - by this point in the code, sending is
        // already known to be appropriate. This step only decides
        // whether to actually SEND it, versus leaving it as a
        // reviewable draft, which stays gated on nora_auto_send and on
        // the draft's own confidence - an uncertain draft
        // (<<<NEEDS_FOLLOWUP>>>) always waits for Itzik personally,
        // regardless of the setting. Any failure here leaves the
        // already-saved draft exactly as if auto-send were off -
        // never a false "sent" state.
        let autoSent = false;
        if (autoSendEnabled && !draftNeedsFollowup) {
          try {
            // Fixed before shipping: the manual send path (Inbox.jsx)
            // sets sender_email to the actual sending user's email,
            // not null - matching that here rather than leaving a
            // gap this path would have introduced. authUsersList is
            // already populated by resolveOwnerUserId's admin
            // listUsers() call above.
            const senderUser = (authUsersList || []).find(u => u.id === ownerUserId);
            let senderEmailForSend = senderUser?.email || null;
            if (!senderEmailForSend && ownerUserId) {
              // resolveOwnerUserId's fast path (rawUserId already a
              // UUID) returns without ever populating authUsersList -
              // fetch directly rather than leave this null in that case.
              const { data: fetchedUser } = await supabase.auth.admin.getUserById(ownerUserId);
              senderEmailForSend = fetchedUser?.user?.email || null;
            }
            const { data: integ } = await supabase.from('user_integrations').select('email_provider').eq('user_id', ownerUserId).maybeSingle();
            const isGmail = integ?.email_provider === 'gmail';

            const { data: sendData, error: sendError } = await supabase.functions.invoke(
              isGmail ? 'send_email_via_gmail' : 'send_email_via_microsoft',
              { body: {
                user_id: isGmail ? ownerUserId : (email.user_id || null),
                to_email: email.sender_email,
                subject: 'Re: ' + (email.subject || ''),
                body: draftBody,
                reply_to_message_id: email.id,
              } }
            );

            if (sendError || sendData?.error) throw new Error(sendError?.message || sendData?.error || 'Send failed');

            const respondedAt = new Date().toISOString();
            await supabase.from('emails').insert({
              subject: 'Re: ' + (email.subject || ''),
              body: draftBody,
              is_sent: true,
              is_read: true,
              direction: 'outgoing',
              sender_email: senderEmailForSend,
              to_email: email.sender_email,
              thread_id: email.thread_id || null,
              project_id: email.project_id || null,
              received_at: respondedAt,
              sent_at: respondedAt,
              created_at: respondedAt,
            });

            await supabase.from('emails').update({
              is_replied: true,
              ai_auto_responded: true,
              ai_auto_responded_at: respondedAt,
            }).eq('id', email.id);

            await supabase.from('email_auto_drafts').update({ status: 'sent' }).eq('id', savedDraft.id);

            if (ownerUserId) {
              await supabase.from('tasks').insert({
                title: 'Nora sent an auto-response: ' + (email.subject || 'no subject'),
                description: 'Review what was sent and confirm nothing further is needed from you.',
                due_date: respondedAt.slice(0, 10),
                task_type: 'email',
                source: 'assistant',
                status: 'open',
                project_id: email.project_id || null,
                linked_email_message_id: email.id,
                user_id: ownerUserId,
              });
            }

            autoSent = true;
            console.log('[cron-auto-draft] Auto-sent response to', email.id);
          } catch (autoSendErr) {
            console.warn('[cron-auto-draft] Auto-send failed for', email.id, '- draft left pending for manual review:', autoSendErr.message);
          }
        }

        results.drafted++;
        if (autoSent) results.autoSent = (results.autoSent || 0) + 1;

      } catch (e) {
        results.errors++;
        console.error('[cron-auto-draft] Email', email.id, e.message);
      }
    }

    // ── AUTO-CHASER: send payment reminders for invoices 3+ days overdue ──────
    const chaserResults = { checked: 0, chased: 0, errors: 0 };
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { data: overdueInvoices } = await supabase
        .from('invoices')
        .select('id, invoice_number, bill_to_name, bill_to_email, due_date, total, vat_rate, vat_amount, chaser_sent_at, chaser_count')
        .eq('status', 'unpaid')
        .not('due_date', 'is', null)
        .lte('due_date', threeDaysAgo);

      for (const inv of overdueInvoices || []) {
        chaserResults.checked++;
        // Skip if chaser already sent in last 7 days
        if (inv.chaser_sent_at) {
          const daysSince = (Date.now() - new Date(inv.chaser_sent_at).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince < 7) continue;
        }
        if (!inv.bill_to_email) continue;

        try {
          const firstName = (inv.bill_to_name || '').split(' ')[0] || inv.bill_to_name || '';
          const grand = parseFloat(inv.total || 0) + parseFloat(inv.vat_amount || 0);
          const vatNote = parseFloat(inv.vat_rate || 0) > 0 ? ' (inc. VAT)' : '';
          const body = `Hi ${firstName},\n\nI hope you are well. I am writing to follow up on invoice ${inv.invoice_number}${inv.due_date ? `, which was due on ${new Date(inv.due_date).toLocaleDateString('en-GB')},` : ','} for the amount of £${grand.toFixed(2)}${vatNote}. This may be an oversight — if you could please let me know once the invoice has been settled, that would be much appreciated. If you have any questions regarding this invoice, please do not hesitate to get in touch.\n\nKind regards,\nNora\nOn behalf of Itzik Darel`;

          // Send via email API
          const sendRes = await fetch((process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://nora-d9wy.vercel.app') + '/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: inv.bill_to_email,
              subject: `Invoice ${inv.invoice_number} — Payment Reminder`,
              body,
              from_name: 'Square One Consulting',
            }),
          });

          if (sendRes.ok) {
            await supabase.from('invoices').update({
              chaser_sent_at: new Date().toISOString(),
              chaser_count: (inv.chaser_count || 0) + 1,
            }).eq('id', inv.id);
            chaserResults.chased++;
            console.log('[cron-auto-draft] Chaser sent for invoice', inv.invoice_number, 'to', inv.bill_to_email);
          }
        } catch (e) {
          chaserResults.errors++;
          console.warn('[cron-auto-draft] Chaser failed for invoice', inv.invoice_number, e.message);
        }
      }
    } catch (e) {
      console.warn('[cron-auto-draft] Auto-chaser error:', e.message);
    }

    // ── BACKFILL EMBEDDINGS for any project_memory rows missing them ────────────
    try {
      const { data: missingEmbeddings } = await supabase
        .from('project_memory')
        .select('id, summary')
        .is('embedding', null)
        .limit(20);

      if (missingEmbeddings?.length) {
        for (const row of missingEmbeddings) {
          try {
            const embRes = await fetch('https://api.openai.com/v1/embeddings', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'text-embedding-3-small', input: row.summary }),
            });
            const embData = await embRes.json();
            const embedding = embData.data?.[0]?.embedding;
            if (embedding) await supabase.from('project_memory').update({ embedding }).eq('id', row.id);
          } catch(e) { /* non-fatal */ }
        }
        console.log('[cron-auto-draft] Backfilled embeddings for', missingEmbeddings.length, 'rows');
      }
    } catch(e) { console.warn('[cron-auto-draft] Embedding backfill error:', e.message); }

    console.log('[cron-auto-draft] Done:', results, 'Chasers:', chaserResults);
    return res.status(200).json({ ok: true, ...results, chasers: chaserResults });

  } catch (err) {
    console.error('[cron-auto-draft] Fatal:', err);
    return res.status(500).json({ error: err.message });
  }
}
