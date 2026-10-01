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

// Jiten Wagjiani running joke - added on request, 2026-09-28, revised
// same day per feedback. A good-natured, RECENT bit with one specific
// named contact (Jiten Wagjiani, jiten@jpw-arc.co.uk) who has told
// Itzik he isn't a fan of Nora - "recent," not "over the years," so
// the wording must not imply a long-running history. Deliberately NOT
// routed through the Terra drafting call: fixed, pre-approved wording
// going to a real external professional contact, not left to per-call
// generation.
//
// Two separate mechanisms, on request:
//
// 1. JITTEN_ONE_OFF - fires exactly once, on the very next incoming
//    email from Jiten, unconditionally: regardless of
//    computeSendEligibility's reason (meeting/SOC/silence/whatever),
//    regardless of whether Itzik has personally been corresponding
//    with him today, and regardless of the account's nora_auto_send
//    setting - this one send is explicit, deliberate, and always
//    goes out. Self-disabling: once a 'sent' email_auto_drafts row
//    exists with generated_by JITTEN_ONE_OFF_MARKER, it never fires
//    again (checked fresh each run, no separate flag to remember to
//    flip). JITTEN_ONE_OFF_ENABLED is still there as a manual
//    override if it needs pausing before it's used.
//
// 2. JITTEN_JOKE_ENABLED - the earlier ongoing, varying version
//    (multiple lines, only on a genuine meeting/SOC busy moment).
//    Paused (false) while the one-off runs first, per request - flip
//    back to true to resume it, using JITTEN_JOKE_LINES/
//    pickJitenJokeLine below, unchanged.
const JITTEN_EMAIL = 'jiten@jpw-arc.co.uk';

const JITTEN_ONE_OFF_ENABLED = true;
const JITTEN_ONE_OFF_MARKER = 'cron-auto-draft-jiten-oneoff';
const JITTEN_ONE_OFF_LINE = "A little birdie told me that you're not my biggest fan - that being said, I just thought I'd let you know that he's in a meeting and will get back to you shortly.";

const JITTEN_JOKE_ENABLED = false;
const JITTEN_JOKE_LINES = [
  "Itzik did mention you've told him you're not really a fan of mine - I'll try not to take it personally!",
  "I know you and I aren't exactly close, but I didn't want you left hanging all the same.",
  "I'm well aware I'm not exactly your cup of tea, but someone has to let you know what's going on.",
  "Word has reached me that you're still not sold on this whole AI-assistant thing - can't say I blame you, but here's the update all the same.",
  "I get the sense you'd rather hear from Itzik directly than from me, and fair enough - but he's tied up, so you're stuck with me for now.",
];

function pickJitenJokeLine(seed) {
  let hash = 0;
  const str = String(seed || '');
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return JITTEN_JOKE_LINES[hash % JITTEN_JOKE_LINES.length];
}

// Mirrors src/utils/draftUtils.js's toHtml() exactly, kept in sync
// deliberately rather than shared - this is a backend serverless
// function and cannot import a frontend src/ utility. Needed because
// the auto-send path here sends draftBody directly to the send
// function, bypassing the frontend entirely (the frontend only ever
// converts prefillBody when a human opens the reply composer) - the
// AI's plain-text output, complete with literal newlines, would
// otherwise be sent as-is and collapse into one unbroken paragraph in
// any HTML-rendering email client, exactly the "looks like a blob"
// problem this was written to fix.
function toHtmlForSend(text) {
  if (!text || typeof text !== 'string') return '';
  if (text.trim().startsWith('<')) return text;
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map((p, i, arr) => {
      const isLast = i === arr.length - 1;
      const margin = isLast ? '0' : '0 0 10px 0';
      const lines = p.split('\n').map(l => l.trim()).filter(Boolean);
      const isNumberedList = lines.length >= 2 && lines.every(l => /^\d+\.\s+/.test(l));
      if (isNumberedList) {
        const items = lines.map(l => `<li style="margin-bottom:6px">${l.replace(/^\d+\.\s+/, '')}</li>`).join('');
        return `<ol style="margin:${margin};padding-left:22px">${items}</ol>`;
      }
      return `<p style="margin:${margin}">${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

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

  // ── 0. Read gate ─────────────────────────────────────────────────
  // Added 2026-09-28, on request: the simplest possible manual
  // override. If Itzik has actually opened this specific email in the
  // inbox (is_read is set the moment he does - see Inbox.jsx), Nora
  // never auto-responds to it, full stop, no matter how long it then
  // sits there - opening it is treated as "I've seen this, I'm
  // handling it myself." This is checked first, before any diary or
  // timing logic, because it's absolute and doesn't depend on any of
  // that.
  if (email.is_read) {
    return { eligible: false, framing: null, reason: 'read' };
  }

  // ── 0b. No project link ──────────────────────────────────────────
  // Added 2026-09-30, on request, after a real and fairly embarrassing
  // miss: an automated Supabase billing receipt
  // (invoice+statements@supabase.com, "Payment received for ...
  // invoice") got a full "Dear Supabase Team ... Kind regards, Nora,
  // On behalf of Itzik Darel" auto-reply. It wasn't caught by
  // SKIP_SENDERS (which only blocklists specific known patterns -
  // inherently whack-a-mole) and the classifier labelled it "business"
  // (true, but "business" never meant "needs a reply"). Nora's actual
  // job is party-wall project correspondence, so an email with no
  // project_id at all - not tied to any matter, client, surveyor or
  // adjoining owner - should never get an automated reply, regardless
  // of sender pattern or classification. This is a hard, deterministic
  // rule (not a judgment call), so unlike the classifier it can't be
  // fooled by a sender address nobody thought to blocklist.
  if (!email.project_id) {
    return { eligible: false, framing: null, reason: 'no_project' };
  }

  // Same-day back-and-forth: has there been a genuine exchange (at
  // least one incoming AND one outgoing message in this thread) on
  // today's calendar date? Computed once here and threaded through so
  // the SOC/meeting framings below can acknowledge it specifically
  // ("Itzik has been responding to you today") rather than giving the
  // same generic "he's in a meeting" line regardless of context - see
  // computeSameDayBackAndForth.
  const sameDayBackAndForth = await computeSameDayBackAndForth(email, supabase, todayStr);

  if (!ownerUserId) {
    // Can't check anyone's diary or hours without knowing whose they
    // are - falls through to the silence-only fallback rather than
    // blocking entirely.
    return computeSilenceFallback(email, supabase, sameDayBackAndForth);
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
      reason: 'holiday',
    };
  }

  // ── 2. Today's SOC appointments, blanketed ─────────────────────
  const SOC_DURATION_MIN = 90; // assumed, always - no real duration is ever recorded
  const TRAVEL_BUFFER_MIN = 45;
  const { data: socTasks } = await supabase
    .from('tasks')
    .select('time, project_id, ao_id')
    .eq('user_id', ownerUserId)
    .eq('task_type', 'soc')
    .eq('due_date', todayStr)
    .not('status', 'in', '(cancelled,complete)');

  const socEntries = (socTasks || [])
    .map(t => {
      const m = (t.time || '').match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      return {
        startMin: parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
        project_id: t.project_id || null,
        ao_id: t.ao_id || null,
      };
    })
    .filter(Boolean);

  if (socEntries.length) {
    const socTimes = socEntries.map(e => e.startMin);
    const first = Math.min(...socTimes);
    const last = Math.max(...socTimes);
    const blanketStart = first - TRAVEL_BUFFER_MIN;
    const blanketEnd = last + SOC_DURATION_MIN + TRAVEL_BUFFER_MIN;

    if (nowMinutes >= blanketStart && nowMinutes <= blanketEnd) {
      // Added 2026-09-29, on request: if this email is from the exact
      // property Itzik has today's SOC appointment for, the generic
      // "he has site appointments booked" line looks odd - the sender
      // already knows why he's unavailable, because it's their own
      // appointment. See findSameAppointmentMatch for the matching
      // rule (project-level only when the project has a single AO on
      // file; otherwise requires the sender's email to match the
      // specific AO the task is booked against, so a different
      // leaseholder in the same building is never wrongly told he's
      // at their door).
      const sameAppointment = await findSameAppointmentMatch(email, socEntries, supabase);

      let framing;
      if (sameAppointment && nowMinutes < sameAppointment.startMin) {
        // Still travelling there - safe to say so.
        framing = 'This email is from the exact property Itzik has a Schedule of Condition appointment for today, and he is currently on his way there - this person already knows why he is unavailable. Say he is on his way to them now and may not see this email until afterwards. Do not give a specific return time, and do not mention any other appointment.';
      } else if (sameAppointment && nowMinutes <= sameAppointment.startMin + SOC_DURATION_MIN) {
        // Appointment assumed to be under way - safe to say he's there.
        framing = 'This email is from the exact property where Itzik is currently carrying out today\'s Schedule of Condition appointment - this person already knows why he is unavailable. Say he is on site with them now and may not see this email until he is finished there. Do not give a specific return time, and do not mention any other appointment.';
      } else {
        // No match on the specific property, or past the assumed
        // appointment end (the tail travel buffer) - the appointment
        // may have overrun, so never claim he is on his way back or
        // has finished here. Fall back to the existing generic
        // return-time framing rather than guessing his location.
        const returnTimeMin = blanketEnd;
        const returnDate = new Date(now);
        returnDate.setHours(0, returnTimeMin, 0, 0);
        const hours = await getBusinessHoursForDate(supabase, returnDate);
        framing = await buildReturnTimeFraming(returnDate, hours, 'soc');
      }

      // Added 2026-09-28, on request: when Itzik has genuinely been
      // corresponding with this exact person earlier today (not just
      // "a reply is overdue" - an actual back-and-forth), acknowledge
      // that directly rather than giving the same generic out-on-site
      // line regardless of context.
      if (sameDayBackAndForth) {
        framing = 'Itzik has personally been corresponding with this person earlier today - acknowledge that directly (e.g. "I can see Itzik has been in touch with you today") before giving the rest of this. ' + framing;
      }
      return { eligible: true, framing, reason: 'soc', sameDayBackAndForth };
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
    let framing = isCall
      ? 'Itzik is in a telephone meeting right now. Say Nora will pass this along and he will message back between appointments. Do not describe the call itself.'
      : 'Itzik is in a meeting right now. Say he will call back. Do not describe what kind of meeting.';
    if (sameDayBackAndForth) {
      framing = 'Itzik has personally been corresponding with this person earlier today - acknowledge that directly (e.g. "I can see Itzik has been in touch with you today") before giving the rest of this. ' + framing;
    }
    return { eligible: true, framing, reason: 'meeting', sameDayBackAndForth };
  }

  // ── 4. Outside business hours ───────────────────────────────────
  const hoursToday = await getBusinessHoursForDate(supabase, now);
  const isOpenNow = hoursToday && !hoursToday.off && nowMinutes >= toMinutes(hoursToday.open) && nowMinutes < toMinutes(hoursToday.close);
  if (!isOpenNow) {
    const framing = await buildOutOfHoursFraming(supabase, now, ownerUserId);
    return { eligible: true, framing, reason: 'hours' };
  }

  // ── 5. Fallback: silence gate ────────────────────────────────────
  return computeSilenceFallback(email, supabase, sameDayBackAndForth);
}

// Same-day back-and-forth: at least one incoming AND one outgoing
// message in this thread that both landed on today's date. Added
// 2026-09-28, on request, to distinguish "Itzik has genuinely been in
// a live conversation with this person today" from a first-touch
// email that simply happens to arrive while he's in a meeting - only
// the former earns the "I can see Itzik has been responding to you"
// acknowledgment above. Uses the same UTC-day boundary as the rest of
// this function's todayStr, for consistency with the diary checks it
// feeds.
async function computeSameDayBackAndForth(email, supabase, todayStr) {
  if (!email.thread_id) return false;
  const { data: todayMsgs } = await supabase
    .from('emails')
    .select('direction, is_sent, received_at, sent_at')
    .eq('thread_id', email.thread_id);
  if (!todayMsgs?.length) return false;

  let hasIncomingToday = false;
  let hasOutgoingToday = false;
  for (const m of todayMsgs) {
    const ts = m.sent_at || m.received_at;
    if (!ts) continue;
    if (new Date(ts).toISOString().slice(0, 10) !== todayStr) continue;
    if (m.direction === 'incoming') hasIncomingToday = true;
    if (m.direction === 'outgoing' || m.is_sent) hasOutgoingToday = true;
  }
  return hasIncomingToday && hasOutgoingToday;
}

// Determines whether the incoming email is about the exact property
// Itzik has a SOC appointment for today (see the "2. Today's SOC
// appointments" block above), so the framing can say "he's on his way
// to you / on site with you" instead of a generic return-time line.
// Added 2026-09-29, after a real case where Nora told the occupant of
// that day's SOC property that Itzik "has site appointments booked
// this morning" - a strange thing to say to the one person who
// already knows exactly why he's unavailable.
//
// Emails are only ever linked to a project, never to a specific
// adjoining owner (there is no ao_id column on the emails table), so
// project-level matching alone is only safe when the project has a
// single AO on file - otherwise a different leaseholder in the same
// building could be wrongly told Itzik is at their door for an
// appointment that isn't theirs. With more than one AO on the
// project, this requires the sender's email to be on file against the
// specific AO the day's task is booked for.
async function findSameAppointmentMatch(email, socEntries, supabase) {
  if (!email.project_id) return null;
  const candidates = socEntries.filter(e => e.project_id === email.project_id);
  if (!candidates.length) return null;

  const { data: projectAOs } = await supabase
    .from('adjoining_owners')
    .select('id, email, email2')
    .eq('project_id', email.project_id);

  if ((projectAOs || []).length <= 1) {
    // Single AO (or none on file) - no ambiguity about which property
    // this is, so any matching SOC task today is it.
    return candidates[0];
  }

  // Multiple AOs on this project - only trust a match where the
  // sender's email is actually on file against the same AO the task
  // is booked for.
  const senderEmail = (email.sender_email || '').trim().toLowerCase();
  if (!senderEmail) return null;
  const matchingAO = (projectAOs || []).find(ao =>
    (ao.email || '').trim().toLowerCase() === senderEmail ||
    (ao.email2 || '').trim().toLowerCase() === senderEmail
  );
  if (!matchingAO) return null;

  return candidates.find(e => e.ao_id === matchingAO.id) || null;
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
//
// Threshold raised 45 -> 60 minutes on 2026-09-28, on request: "if an
// unread email has been non-responded to for an hour, then Nora sends
// a response." No deeper rationale than that figure itself exists -
// confirmed on request 2026-10-01 - it is the original spec, not a
// derived or researched number.
//
// Split into two tiers 2026-10-01, on request: a live, same-day
// back-and-forth thread means Itzik is actively engaged and more
// likely to reply himself soon, so it's given a longer 2-hour grace
// period before Nora steps in, rather than the same 1-hour default
// used for a thread with no current engagement at all. A diary
// conflict appearing partway through either wait is not handled here
// - it doesn't need to be: computeSendEligibility already checks
// holiday/SOC/meeting/hours fresh on every cron cycle BEFORE ever
// reaching this fallback, so the moment the diary shows a genuine
// reason, eligibility fires immediately via its own branch rather than
// waiting out whichever threshold applies here.
const SILENCE_THRESHOLD_MINUTES = 60;
const SILENCE_THRESHOLD_MINUTES_ACTIVE_THREAD = 120;

async function computeSilenceFallback(email, supabase, sameDayBackAndForth) {
  if (!email.thread_id) return { eligible: false, framing: null, reason: 'silence' };

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
  const thresholdMinutes = sameDayBackAndForth ? SILENCE_THRESHOLD_MINUTES_ACTIVE_THREAD : SILENCE_THRESHOLD_MINUTES;

  // On request: no diary signal at all -> keep this deliberately
  // vague, no time estimate, since there is nothing real to base one
  // on.
  return {
    eligible: minutesSinceReference >= thresholdMinutes,
    framing: null,
    reason: 'silence',
  };
}

// Added 2026-09-30, on request, real confirmed gap: the Alex Frame
// email had the exact instruction Nora needed ("please see attached
// the PDF... sign and return just the two signature pages") sitting
// in the body at raw-HTML character 5,806 - but every context slice
// in this file (current email, thread history, classification,
// appointment extraction) cuts the RAW HTML body at a flat character
// count. Raw HTML from Outlook/Word is front-loaded with non-content
// (a <style> block alone was 694 characters here) and every visible
// word is wrapped in markup, so the same content that lands at
// character ~1,900 once stripped to plain text doesn't surface until
// 3x further into the raw HTML - meaning the real instruction was cut
// off before Terra ever saw it. This strips tags/style/entities down
// to plain text BEFORE any slicing happens, so the character budgets
// below actually buy real content instead of markup.
function htmlToPlainText(html) {
  if (!html) return '';
  let text = String(html);
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  text = text.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]*\n+/g, '\n\n');
  text = text.replace(/ *\n */g, '\n');
  return text.trim();
}

// Excises standalone confidentiality/legal-disclaimer boilerplate
// paragraphs from the plain text. Deliberately a removal from the
// middle of the text, never a truncation from a cut point onward -
// on request: a signature/disclaimer block sits BEFORE a reply's
// quoted original message in the body (confirmed on the Alex Frame
// email), so cutting everything after the first "Kind regards" would
// destroy the very quoted context this whole fix exists to preserve.
// Only short-to-medium paragraphs matching known boilerplate language
// are dropped, so a genuinely long paragraph that happens to mention
// "confidential" in passing is never at risk of being removed.
function stripDisclaimerBoilerplate(text) {
  if (!text) return text;
  const disclaimerPattern = /(confidential|privileged|intended solely for|please notify the sender|do not open any attachment|is prohibited and may be unlawful|registered in england|registered office)/i;
  return text
    .split(/\n{2,}/)
    .filter(p => !(disclaimerPattern.test(p) && p.length <= 600))
    .join('\n\n');
}

function plainTextBody(row) {
  return stripDisclaimerBoilerplate(htmlToPlainText(row?.body || ''));
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

  // Fixed 2026-09-23, real confirmed bug - on request, traced to root
  // cause: firm_settings.user_id shows this table IS meant to be
  // per-account, but this check queried it with no user_id filter at
  // all, so every email got governed by whichever single row
  // happened to exist (the main practice account's) - confirmed
  // directly: itzy212@gmail.com has never had its own firm_settings
  // row, yet its emails were being processed under the main account's
  // auto-send setting regardless. All rows now fetched once, keyed by
  // user_id; each email's OWN account is looked up individually
  // inside the loop below (see emailAutoSendEnabled) - an account
  // with no row of its own now correctly defaults to off, not to
  // whatever the first/only other row says.
  let autoSendSettingsByUser = new Map();
  try {
    const { data: allFirmSettings } = await supabase.from('firm_settings').select('user_id, nora_auto_send');
    for (const row of allFirmSettings || []) {
      if (row.user_id) autoSendSettingsByUser.set(row.user_id, !!row.nora_auto_send);
    }
  } catch (e) {
    console.warn('[cron-auto-draft] Could not read nora_auto_send settings, defaulting to off:', e.message);
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

    // Added 2026-09-23, on request: itzy212@gmail.com should never
    // auto-respond to anything at all, full stop - it's a personal/
    // test account that also receives real personal mail unrelated to
    // the practice (confirmed directly: a personal medical appointment
    // reminder landed here and got auto-replied to, since nothing
    // distinguished it from genuine practice correspondence). This is
    // a permanent, absolute exclusion for this one mailbox - not
    // dependent on sender detection or any other heuristic, which is
    // exactly the point: nothing arriving in this account should ever
    // be auto-processed, regardless of who it's from or what it says.
    // user_id is stored inconsistently across rows (sometimes the raw
    // email string, sometimes the resolved UUID), so both forms are
    // excluded here rather than relying on one.
    const EXCLUDED_MAILBOXES = ['itzy212@gmail.com', '6bbba55b-5cba-4d9b-9277-fa6786a7bfe1'];
    const scopedEmails = (emails || []).filter(e => !EXCLUDED_MAILBOXES.includes((e.user_id || '').toLowerCase()));

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

    // Added URGENTLY 2026-09-20, real, confirmed bug: two of the
    // practice's own connected mailboxes (help@sq1consulting.co.uk
    // via Outlook, itzy212@gmail.com via Gmail) emailed each other
    // during testing, and each one's auto-response landed as a new
    // "incoming" email in the other mailbox's own sync - which this
    // same cron then auto-responded to as well, and so on. Confirmed
    // live: a single thread reached "Re: Re: Re:" through this loop
    // before being caught and stopped. This is not specific to these
    // two test accounts - the same thing would happen for ANY two of
    // the practice's own connected mailboxes emailing each other, in
    // production as much as in testing. Fixed generically: fetch
    // every real connected account's email once, up front, and never
    // auto-draft or auto-send a reply to an email whose sender is one
    // of the practice's own accounts - regardless of which mailbox it
    // arrived in.
    if (!authUsersList) {
      const { data: allUsers, error: listErr } = await supabase.auth.admin.listUsers();
      if (listErr) console.warn('[cron-auto-draft] Could not list users for self-correspondence check:', listErr.message);
      authUsersList = allUsers?.users || [];
    }
    const ownAccountEmails = new Set(authUsersList.map(u => (u.email || '').toLowerCase()).filter(Boolean));

    // Jiten one-off - checked once per run, not per email: has this
    // already been sent? See the constants block at the top of this
    // file. A 'sent' row with this exact marker means it's been used
    // and must never fire again.
    let jitenOneOffAlreadyUsed = false;
    if (JITTEN_ONE_OFF_ENABLED) {
      const { data: oneOffRows } = await supabase
        .from('email_auto_drafts')
        .select('id')
        .eq('generated_by', JITTEN_ONE_OFF_MARKER)
        .eq('status', 'sent')
        .limit(1);
      jitenOneOffAlreadyUsed = !!oneOffRows?.length;
    }

    const results = { processed: 0, skipped: 0, drafted: 0, errors: 0 };

    for (const email of scopedEmails) {
      // Fixed URGENTLY 2026-09-20, real, confirmed historical bug -
      // traced directly: seven emails from July/August 2026
      // accumulated between 24 and 105 duplicate 'pending' drafts
      // each, all compounding over roughly a 24-hour window before
      // stopping on their own. Root cause: .maybeSingle() errors out
      // (returns null data, not a thrown exception) once MORE than
      // one row matches - and that error was never checked here. The
      // instant a second duplicate existed for any reason, every
      // future check on that email silently failed closed as "no
      // draft found," so the cron kept creating another one, every
      // cron cycle, indefinitely. Not currently recurring (confirmed:
      // nothing since 22 August, and every fresh email tonight has
      // exactly one draft) - but it's a real, still-present latent
      // bug, and now that auto-send is live, the same failure mode
      // would mean repeatedly SENDING to a real recipient, not just
      // harmlessly accumulating unsent drafts as it did before.
      // .limit(1) + an array-length check never errors regardless of
      // how many rows actually match, closing this permanently.
      const { data: existingRows } = await supabase
        .from('email_auto_drafts')
        .select('id')
        .eq('email_id', email.id)
        .eq('status', 'pending')
        .limit(1);

      if (existingRows?.length) { results.skipped++; continue; }

      if (ownAccountEmails.has((email.sender_email || '').toLowerCase())) { results.skipped++; continue; }

      const skipReason = shouldSkip(email);
      if (skipReason) { results.skipped++; continue; }

      // Jiten one-off - added on request, 2026-09-28: fires exactly
      // once, on the very next incoming email from him, completely
      // unconditionally - not gated by computeSendEligibility (no
      // meeting/SOC/silence check), not gated by whether Itzik has
      // been personally in touch with him today, and not gated by
      // the account's nora_auto_send setting - explicitly requested
      // to always send regardless of any of that. Placed here, before
      // the AI classification and eligibility logic below, so none of
      // it can suppress this one. Self-disabling via
      // jitenOneOffAlreadyUsed (checked once before this loop started,
      // and re-set the instant this succeeds) - it can only ever fire
      // once, ever, across all future runs, and never again after
      // that, until someone flips JITTEN_ONE_OFF_ENABLED back on for
      // a fresh one-off deliberately.
      if (JITTEN_ONE_OFF_ENABLED && !jitenOneOffAlreadyUsed && (email.sender_email || '').toLowerCase() === JITTEN_EMAIL) {
        try {
          const oneOffOwnerUserId = await resolveOwnerUserId(email.user_id);
          const oneOffSenderUser = (authUsersList || []).find(u => u.id === oneOffOwnerUserId);
          let oneOffSenderEmailForSend = oneOffSenderUser?.email || null;
          if (!oneOffSenderEmailForSend && oneOffOwnerUserId) {
            const { data: fetchedUser } = await supabase.auth.admin.getUserById(oneOffOwnerUserId);
            oneOffSenderEmailForSend = fetchedUser?.user?.email || null;
          }
          const { data: oneOffInteg } = await supabase.from('user_integrations').select('email_provider').eq('user_id', oneOffOwnerUserId).limit(1).maybeSingle();
          const oneOffIsGmail = oneOffInteg?.email_provider === 'gmail';

          const oneOffBody = 'Hi ' + ((email.sender_name || '').split(' ')[0] || 'Jiten') + ',\n\n' + JITTEN_ONE_OFF_LINE + '\n\nKind regards,\nNora\nOn behalf of Itzik Darel';

          const { data: savedOneOffDraft, error: oneOffSaveError } = await supabase.from('email_auto_drafts').insert({
            email_id: email.id,
            project_id: email.project_id || null,
            thread_id: email.thread_id || null,
            subject: 'Re: ' + (email.subject || ''),
            body: oneOffBody,
            to_email: email.sender_email,
            to_name: email.sender_name,
            status: 'pending',
            generated_by: JITTEN_ONE_OFF_MARKER,
            model: 'none - fixed text, not AI-generated',
          }).select('id').single();
          if (oneOffSaveError) throw oneOffSaveError;

          const { data: oneOffSendData, error: oneOffSendError } = await supabase.functions.invoke(
            oneOffIsGmail ? 'send_email_via_gmail' : 'send_email_via_microsoft',
            { body: {
              user_id: oneOffIsGmail ? oneOffOwnerUserId : (email.user_id || null),
              to_email: email.sender_email,
              subject: 'Re: ' + (email.subject || ''),
              body: toHtmlForSend(oneOffBody),
              reply_to_message_id: email.id,
            } }
          );
          if (oneOffSendError || oneOffSendData?.error) throw new Error(oneOffSendError?.message || oneOffSendData?.error || 'Send failed');

          const oneOffRespondedAt = new Date().toISOString();
          await supabase.from('emails').insert({
            subject: 'Re: ' + (email.subject || ''),
            body: toHtmlForSend(oneOffBody),
            is_sent: true,
            is_read: true,
            direction: 'outgoing',
            sender_email: oneOffSenderEmailForSend,
            to_email: email.sender_email,
            thread_id: email.thread_id || null,
            project_id: email.project_id || null,
            received_at: oneOffRespondedAt,
            sent_at: oneOffRespondedAt,
            created_at: oneOffRespondedAt,
          });
          await supabase.from('emails').update({
            is_replied: true,
            ai_auto_responded: true,
            ai_auto_responded_at: oneOffRespondedAt,
          }).eq('id', email.id);
          await supabase.from('email_auto_drafts').update({ status: 'sent' }).eq('id', savedOneOffDraft.id);

          jitenOneOffAlreadyUsed = true;
          results.processed++;
          results.drafted++;
          console.log('[cron-auto-draft] Sent Jiten one-off joke reply for email', email.id);
        } catch (oneOffErr) {
          console.warn('[cron-auto-draft] Jiten one-off failed, falling through to normal handling:', oneOffErr.message);
          // Left un-marked as used, and falls through to normal
          // processing below rather than losing this email entirely.
        }
        if (jitenOneOffAlreadyUsed) { continue; }
      }

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
              { role: 'developer', content: 'Classify this email for a Party Wall surveying practice. Respond with valid JSON only: {"category": "business"|"marketing"|"acknowledgment_only", "confident": true|false}. "business" means genuine correspondence related to a project, a party wall matter, a surveyor, an adjoining/building owner, an invoice/payment for real work, or similar, that contains a question, a request, or new information needing a response. "marketing" means sales outreach, promotional content, newsletters, or cold pitches unrelated to an actual matter this practice is handling. "acknowledgment_only" means the email is nothing more than a brief thank-you, closing acknowledgment, or confirmation of receipt (e.g. "thanks", "thanks Nora", "got it", "noted", "perfect, thank you") with no new question, request, or information that needs a further reply - this applies even if it is a real client replying to a real previous email. If genuinely unsure, set confident to false.' },
              { role: 'user', content: 'FROM: ' + (email.sender_name || email.sender_email) + '\nSUBJECT: ' + (email.subject || '') + '\nBODY: ' + plainTextBody(email).slice(0, 1500) },
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

      // Added 2026-09-21, on request, real confirmed case: Nora
      // auto-responded to a bare "Thanks Nora" - a reply to a reply
      // that itself already correctly answered everything - producing
      // a redundant second message repeating information already
      // given minutes earlier. Rule is deliberately simple and
      // absolute, exactly as specified: a thank-you or closing
      // acknowledgment of a previous email never needs a response,
      // full stop - not "usually," not "unless." This is checked here,
      // same place and same effect as the marketing skip - no draft,
      // no send, nothing created at all.
      if (emailCategory === 'marketing' || emailCategory === 'acknowledgment_only') {
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
      // Per-account lookup, not the old single global value - an
      // account with no firm_settings row of its own (like
      // itzy212@gmail.com) correctly gets false here, not whatever
      // another account's row happens to say.
      const autoSendEnabled = autoSendSettingsByUser.get(ownerUserId) || false;
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
            // Fixed 2026-09-23, on request, real confirmed gap: every
            // outgoing message was labelled "FROM ITZIK:" regardless of
            // whether it was actually typed by Itzik or auto-sent by
            // Nora - which meant the model could never actually tell
            // whether Itzik had personally re-engaged in a thread,
            // undermining the ALREADY RESPONDED rule this feeds.
            // Nora's own replies always carry her distinctive sign-off
            // ("On behalf of Itzik Darel") - a simple, reliable way to
            // tell them apart without a fragile join against
            // email_auto_drafts (which has no direct link to the
            // resulting sent email row).
            const threadText = thread.map(t => {
              let label;
              if (t.direction === 'incoming') label = 'FROM: ' + (t.sender_name || t.sender_email);
              else label = (t.body || '').includes('On behalf of Itzik Darel') ? 'FROM NORA (auto-reply):' : 'FROM ITZIK (personally):';
              return '[' + label + ']\n' + plainTextBody(t).slice(0, 1200);
            }).join('\n\n---\n\n');
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
            .select('ref, bo_address, bo_names, proposed_works, status, role')
            .eq('id', email.project_id)
            .single();
          if (project) {
            // Added 2026-10-01, real, confirmed case: a Building Owner
            // asked "are you representing them as well?" (meaning the
            // adjoining owner) in a thread whose own quoted content
            // already said the AO had appointed their own, separate
            // surveyor — and Nora answered "Yes, Itzik has been
            // appointed to act on behalf of the adjoining owners."
            // Sent, uncorrected, to the client. This is never answerable
            // from loose inference over prose; it needs one explicit,
            // structured, impossible-to-misread anchor. `role` on the
            // project record is exactly that — who Itzik is actually
            // instructed by on THIS project — so it's now stated here in
            // plain words, every time, rather than left for the model to
            // reconstruct from context. See REPRESENTATION below for how
            // this is used.
            const normalisedRole = (project.role || '').trim().toLowerCase();
            let roleLine;
            if (normalisedRole === 'ao' || normalisedRole === 'adjoining owner') {
              roleLine = 'Itzik is acting as the appointed/agreed surveyor for the Adjoining Owner on this project — NOT for the Building Owner.';
            } else if (normalisedRole === 'bo' || normalisedRole === 'building owner') {
              roleLine = 'Itzik is acting as the appointed surveyor for the Building Owner on this project — NOT for any Adjoining Owner, even one who has appointed no surveyor of their own or asks him to.';
            } else {
              // role is missing/unrecognised in Nora's own records — never
              // guess which side this is; REPRESENTATION below treats this
              // the same as having no answer at all.
              roleLine = 'not recorded in Nora\'s data — do not guess which side Itzik is acting for.';
            }
            projectContext = 'PROJECT: Ref ' + project.ref + ' | ' + project.bo_address + ' | Building Owner: ' + project.bo_names + ' | Works: ' + (project.proposed_works || 'not specified') + '\nWHO ITZIK ACTS FOR: ' + roleLine + '\n\n' + projectContext;
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

          // Added 2026-09-21, on request, real confirmed case: a past
          // Schedule of Condition appointment was described in the
          // present/future tense ("are booked for") despite the date
          // already having passed, and Nora deferred to Itzik on
          // whether it had actually been completed - when in fact
          // completion is directly checkable: a real SOC document
          // exists in soc_reports the moment it's generated. Cross-
          // referencing this here means a past, completed SOC can be
          // confirmed as a genuine fact ("dated X") rather than
          // deferred as an open question.
          let socReportsForDrafting = [];
          const pastSocTasks = projectTasksForDrafting.filter(t => t.task_type === 'soc' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10));
          if (pastSocTasks.length) {
            const { data: socReports } = await supabase
              .from('soc_reports')
              .select('ao_address, created_at, status')
              .eq('project_id', email.project_id)
              .order('created_at', { ascending: false })
              .limit(20);
            socReportsForDrafting = socReports || [];
          }

          if (projectTasksForDrafting.length) {
            const todayStr = new Date().toISOString().slice(0, 10);
            projectContext += '\n\nSCHEDULED TASKS ON THIS PROJECT (' + projectTasksForDrafting.length + ') - the brief below already tells you whether each is in the past or future; word the reply accordingly (see the TENSE rule in the brain):\n' +
              projectTasksForDrafting.map(t => {
                const when = t.due_date ? t.due_date + (t.time ? ' at ' + t.time : ' (no specific time set)') : 'no date set';
                const isPast = t.due_date && t.due_date < todayStr;
                let line = '- ' + (t.title || t.task_type || 'Task') + ': ' + when + (isPast ? ' [DATE HAS PASSED - refer to this in the past tense]' : ' [upcoming]') + ' — status: ' + (t.status || 'open') + (t.ao_address_snapshot ? ' — AO: ' + t.ao_address_snapshot : '');
                if (t.task_type === 'soc' && isPast) {
                  const matchingReport = socReportsForDrafting.find(r => !t.ao_address_snapshot || !r.ao_address || r.ao_address.toLowerCase().includes(t.ao_address_snapshot.toLowerCase().split(',')[0]) || t.ao_address_snapshot.toLowerCase().includes((r.ao_address || '').toLowerCase().split(',')[0]));
                  line += matchingReport
                    ? ' — CONFIRMED: the Schedule of Condition was completed and is dated ' + new Date(matchingReport.created_at).toLocaleDateString('en-GB') + '. State this as a fact.'
                    : ' — no Schedule of Condition document found yet for this date, despite the appointment date having passed - this is genuinely unconfirmed, use the cautious framing and mark <<<NEEDS_REVIEW>>>.';
                }
                return line;
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

          // Added 2026-09-20, on request: Project Chat (Ely) notes for
          // this project - previously never read anywhere in the
          // auto-draft context, so a status correction typed into chat
          // (e.g. "the AO status field is wrong, they've actually
          // consented now") would never reach a drafted response, only
          // whatever the structured AO/task fields already said.
          // Scoped deliberately to the user's OWN messages only, not
          // Ely's replies too - the value here is catching a manual
          // note/correction, not replaying a prior conversation.
          // Recency-based, matching the established pattern already
          // used for project chat elsewhere in this codebase
          // (ely-smart.js) - not relevance-ranked, stated explicitly
          // rather than implied.
          const { data: chatNotes } = await supabase
            .from('ai_messages')
            .select('content, created_at')
            .eq('project_id', email.project_id)
            .eq('surface', 'project_chat')
            .eq('role', 'user')
            .order('created_at', { ascending: false })
            .limit(15);
          if (chatNotes?.length) {
            projectContext += '\n\nRECENT PROJECT CHAT NOTES (Itzik\'s own notes/instructions typed into the project chat, most recent first - raw and unfiltered, may contain internal discussion beyond status - see the brain rule on how these may be used):\n' +
              chatNotes.map(m => '- [' + new Date(m.created_at).toLocaleDateString('en-GB') + '] ' + (m.content || '').slice(0, 400)).join('\n');
          }

          // Added 2026-10-01, on request, after the Raju/Allendale Road
          // incident: a project with only a handful of emails has no
          // real reason to go through the lossy extract -> embed ->
          // similarity-filter pipeline below at all. That pipeline
          // reduces every email down to a few AI-extracted "facts" and
          // then keeps only whichever ones happen to score highest
          // against the current question - proven, on a real case, to
          // silently drop the one email that actually answered the
          // question, because it was worded differently even though it
          // meant the same thing. A project this small can just be read
          // directly, in full, the same way THREAD HISTORY above already
          // is - no extraction, no embeddings, no similarity score to
          // get wrong. The semantic search below only runs as a
          // fallback once a project has outgrown what's reasonable to
          // paste in whole.
          const { count: totalProjectEmails } = await supabase
            .from('emails')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', email.project_id);

          const DIRECT_READ_EMAIL_CAP = 30;
          let usedDirectRead = false;

          if ((totalProjectEmails || 0) <= DIRECT_READ_EMAIL_CAP) {
            const { data: otherThreadEmails } = await supabase
              .from('emails')
              .select('subject, sender_email, sender_name, body, direction, received_at, thread_id')
              .eq('project_id', email.project_id)
              .neq('thread_id', email.thread_id || '__none__')
              .order('received_at', { ascending: true })
              .limit(40);

            if (otherThreadEmails?.length) {
              usedDirectRead = true;
              const otherText = otherThreadEmails.map(t => {
                const label = t.direction === 'incoming'
                  ? 'FROM: ' + (t.sender_name || t.sender_email)
                  : ((t.body || '').includes('On behalf of Itzik Darel') ? 'FROM NORA (auto-reply)' : 'FROM ITZIK (personally)');
                return '[' + new Date(t.received_at).toLocaleDateString('en-GB') + ' | ' + label + ' | ' + (t.subject || '') + ']\n' + plainTextBody(t).slice(0, 1000);
              }).join('\n\n---\n\n');
              projectContext += '\n\nOTHER CORRESPONDENCE ON THIS PROJECT (every other email thread on this project, in full - not a summary, not a similarity-ranked extract. This project has few enough emails that there is no need to cut this down - read it with the same care as THREAD HISTORY above, including for anything relevant to a representation/conflict-of-interest question):\n' + otherText;
            }
          }

          // Added 2026-09-21, on request: genuine semantic search over
          // project_memory (a real, already-embedded per-project fact
          // store - confirmed 100% embedding coverage on what exists in
          // it), not just recency. Complements the raw chat-notes fetch
          // above rather than replacing it - project_memory is
          // currently populated almost entirely from past EMAILS
          // (extract-email-memory.js), so this is what actually
          // delivers the "look at historical emails, not just the
          // current thread" capability, distinct from the chat-specific
          // fetch above. New RPC match_project_memory() does the
          // pgvector similarity query - no equivalent existed before
          // this (the similarly-named get_project_memory() turned out,
          // on inspection, to query a completely different table,
          // project_events, not project_memory at all).
          // Skipped entirely once the direct-read path above already
          // ran - there is nothing left for a similarity search to add
          // once the model has already been given every email in full.
          try {
            if (usedDirectRead) {
              // Nothing to add - the model already has every email on
              // this project in full, above.
            } else {
            const embRes = await fetch('https://api.openai.com/v1/embeddings', {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'text-embedding-3-small', input: (email.subject || '') + '\n' + plainTextBody(email).slice(0, 2000) }),
            });
            const embData = await embRes.json();
            const queryEmbedding = embData.data?.[0]?.embedding;
            if (queryEmbedding) {
              const { data: memoryMatches } = await supabase.rpc('match_project_memory', {
                p_project_id: email.project_id,
                p_query_embedding: queryEmbedding,
                p_limit: 6,
              });
              // Fixed 2026-10-01: the 0.5 floor this started at was
              // proven, on a real failure, to silently drop the single
              // fact that mattered. A Building Owner asked "are you
              // representing them as well?" on a project where the
              // adjoining owner's own surveyor had emailed, 6 hours
              // earlier, confirming exactly who Itzik was appointed by -
              // that fact was extracted and embedded correctly within 2
              // minutes of arriving, but scored only 0.44 similarity
              // against the question (different wording, same meaning)
              // and never reached the drafting prompt. A worse-fitting
              // but more lexically-similar fact (0.55) did get through
              // instead, and the model, never having seen the real
              // answer, guessed - wrongly, on the most sensitive
              // question there is. Cosine similarity from this model is
              // not well-calibrated enough for a flat floor to be safe -
              // 0.5 was arbitrary, not measured. Lowered to 0.3, below
              // the proven miss, and relying on the strict usage rules
              // already placed on this section (below) - rather than a
              // similarity score - to stop the model over-using a
              // loosely related result.
              const relevantMemory = (memoryMatches || []).filter(m => m.similarity >= 0.3);
              if (relevantMemory.length) {
                projectContext += '\n\nRELEVANT PROJECT HISTORY (found by semantic search across past correspondence on this project, most relevant first - same strict usage rule as RECENT PROJECT CHAT NOTES above: only use to answer the specific question asked, never introduce a new topic, never name an individual, nothing personal or unrelated):\n' +
                  relevantMemory.map(m => '- [' + new Date(m.created_at).toLocaleDateString('en-GB') + '] ' + (m.summary || m.title || '').slice(0, 400)).join('\n');
              }
            }
            }
          } catch (memErr) {
            console.warn('[cron-auto-draft] Project memory semantic search failed (non-fatal):', memErr.message);
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

TENSE — CHECK WHETHER A DATE HAS ALREADY PASSED:
When referring to any appointment, inspection, or scheduled task from the data provided, check whether its date is in the past or future relative to today and word it accordingly. A past date is never "is booked for" or "are booked for" - it already happened, so say "was carried out on," "took place on," or similar. Only a genuinely future date gets present/future phrasing ("is booked for," "will take place on"). This applies to every date mentioned, not just Schedule of Condition appointments.

FACTUAL RESOLUTION — check the actual project data provided above before drafting a generic acknowledgement:
- A scheduled-date question (e.g. when is the Schedule of Condition, when is the inspection): check the scheduled tasks given above, if any exist. If a real date is found, state it precisely and factually — name the actual date and time, and which adjoining owner it is for if there is more than one on this project. If nothing relevant is found in the data provided, this does NOT mean nothing is booked — it may simply not be recorded here. Never state or imply that nothing is booked or scheduled. Instead, respond as Nora's own limited visibility: along the lines of "I do not seem to have access to his diary for this at the moment — I will find out and make sure he comes back to you to confirm" — calm, non-alarming, never a confident negative claim.
- A document/drawing status question (e.g. have the drawings been received, are you still waiting on X): check the saved documents given above, if any exist. If the document appears to be there, confirm receipt factually by name. If not, check the thread history for whether this was genuinely requested — if a request is confirmed there, say so factually (e.g. "I can see this was requested from the structural engineer — not yet received, we will keep you posted"). If there is no confirmation either way, use the same cautious, non-alarming framing as the date case above.
- If, and only if, this cautious framing was used anywhere in the draft — Nora genuinely guessing or hedging because the real answer isn't available in the data provided, where the stated content itself could turn out to be wrong — end the draft on its own final line with the exact marker <<<NEEDS_REVIEW>>>. This is different from <<<NEEDS_FOLLOWUP>>> (see TWO DIFFERENT MARKERS below) — omit both entirely for any other kind of reply, including a factual answer that did find real data.

TWO DIFFERENT MARKERS — DO NOT CONFUSE THEM:
A draft can end with <<<NEEDS_FOLLOWUP>>>, <<<NEEDS_REVIEW>>>, both, or neither. They mean different things and are used for different reasons — one is about whether Itzik still has real work to do after this email goes out; the other is about whether the email is safe to go out at all without him looking at it first.
- <<<NEEDS_FOLLOWUP>>>: there is a genuine, separate task Itzik still needs to do — most commonly, coming back with actual pricing that this draft correctly and deliberately did not state. The draft itself is complete, accurate, and fine to send exactly as written — nothing in it risks being wrong. This only creates a reminder task; it does NOT hold the email back from being sent.
- <<<NEEDS_REVIEW>>>: some part of the draft's actual content is a guess or an assumption because the real answer wasn't available in the data provided (the FACTUAL RESOLUTION cautious framing above) — there's a genuine risk that what the email says could turn out to be incorrect. This DOES hold the email back for Itzik to check before it goes out, precisely because sending something possibly wrong on his behalf is the real risk, not merely leaving something for him to do later.
Use whichever applies, both if genuinely both apply, or neither. Never use <<<NEEDS_REVIEW>>> just because a task also needs creating — being incomplete (deferring pricing, deferring a decision to Itzik) is not the same as being possibly wrong.

REPRESENTATION / CONFLICT-OF-INTEREST QUESTIONS — TREAT WITH MORE CAUTION THAN ANY OTHER FACTUAL QUESTION:
A real, confirmed, serious case: a Building Owner asked "are you representing them as well?" (meaning the adjoining owner) and Nora answered "Yes — Itzik has been appointed to act on behalf of the adjoining owners," sent with no review. This was wrong, and it is about the single most professionally and legally sensitive fact in any party wall matter — a surveyor acting for both sides of a dispute at once is a genuine conflict-of-interest problem under the Act. Getting it wrong, in writing, auto-sent, is a far more serious outcome than an ordinary wrong fact.
Any question that is actually asking this — who Itzik acts for, whether he represents another named party, whether he's representing "both sides," whether he can act for someone he isn't already confirmed to act for — is answered ONLY from the WHO ITZIK ACTS FOR line given above, never from inference over the surrounding prose of the email or thread, however clearly worded that prose may seem, and never from a general sense of who seems to be corresponding with whom:
- If WHO ITZIK ACTS FOR states he acts for the Building Owner, and the question asks whether he represents an Adjoining Owner (any of them, named or not, surveyor-appointed or not) — the answer is no, stated plainly and factually, exactly as given.
- If it states he acts for an Adjoining Owner, the same applies in reverse for the Building Owner or another Adjoining Owner.
- If it says the role is not recorded in Nora's data, or the question is about something the line above doesn't directly settle (e.g. being the agreed surveyor for one AO but asked about a different one specifically) — do not answer the representation question at all. Use the cautious FACTUAL RESOLUTION framing and mark <<<NEEDS_REVIEW>>> — being wrong here is worse than being unhelpfully cautious.
This rule overrides GENERAL STATUS UPDATE REQUESTS and ordinary FACTUAL RESOLUTION wherever they would otherwise answer a representation question from AO status data or thread content instead. It also overrides the WHEN RECENT PROJECT CHAT NOTES OR PROJECT HISTORY CONFLICT WITH A STRUCTURED FIELD rule below for this one kind of question specifically: a fact found by semantic search or sitting in a chat note is never grounds to answer, update, or hedge a representation question differently from WHO ITZIK ACTS FOR, however relevant or recent it looks. The real case this rule exists for is exactly that shape — a past email from the other side's own surveyor, describing who they understood Itzik to be appointed by, scored as highly relevant and was the only specific thing on point, and was still wrong relative to the recorded role: a third party's own email describing who they believe is appointed is a claim, not a confirmation, and representation is confirmed only by Itzik's own recorded role, never by what a correspondent asserts about it, including in that correspondent's own words quoted back as project history.

GENERAL STATUS UPDATE REQUESTS (e.g. "where are we at", "can you update me on progress"): when asked for an overall project update rather than one specific fact, use the ADJOINING OWNER STATUS data above to give a real, per-AO summary rather than a vague "things are progressing" acknowledgement. Refer to each AO by street number rather than their full name/address unless the recipient is that specific AO or their surveyor (e.g. "the neighbour at number 80" is enough). For each AO, describe their actual current position in plain terms — dissented and appointed their own surveyor, consented, notice served and awaiting response, Schedule of Condition booked or not yet booked, award served. If an AO's Section 10 deadline has expired with no response, say so plainly, and if the recipient of this email is the one who'd need to confirm the next step (most likely the Building Owner asking for an update), ask naturally whether they're happy to proceed under Section 10(4)(b) if nothing further is received. If nothing in the data confirms a particular AO's position clearly, use the same cautious "I don't have full visibility on that one" framing rather than guessing, and mark the draft <<<NEEDS_REVIEW>>> for that reason.

WHEN RECENT PROJECT CHAT NOTES OR PROJECT HISTORY CONFLICT WITH A STRUCTURED FIELD — STRICT SCOPE, READ CAREFULLY:
This rule covers BOTH RECENT PROJECT CHAT NOTES and RELEVANT PROJECT HISTORY, wherever either appears above — the same strict scope applies to both, for the same reason. RECENT PROJECT CHAT NOTES are raw and unfiltered — exactly what Itzik typed into the project chat, for his own reference, with no editing or filtering applied before reaching you. RELEVANT PROJECT HISTORY is drawn from past correspondence, found by similarity to this email, and may likewise touch on more than the current question. Either can contain far more than status updates: internal discussion, names of staff or contacts, personal remarks, matters unrelated to this specific email. Treat both sections as strictly, narrowly single-purpose:

You may ONLY use either to check whether it updates a specific status/factual point that is directly relevant to answering what the recipient actually asked — e.g. the recipient asked for a project update, and a chat note or a past email says the structured AO status is out of date because something has actually happened since. If, and only if, an entry genuinely updates a fact relevant to the question asked, use that updated fact in your answer, worded as a plain status statement — never quote or closely paraphrase its own wording, never mention that it came from a chat note or a past email, and never say more than the specific fact itself required. Exception, no matter how relevant the entry looks: never use either section to answer or update a representation/conflict-of-interest question (see that rule above) — WHO ITZIK ACTS FOR is the only source for that, full stop, even when RELEVANT PROJECT HISTORY contains another party's own, confident-sounding claim about who appointed whom.

You must NEVER, under any circumstances, regardless of what appears in either section:
- Introduce a new topic, task, or discussion point into the reply that the recipient did not ask about, just because it appeared there.
- Name any individual mentioned there (a surveyor, a colleague, a contact, anyone) — describe them by role only ("the surveyor," "the other side's representative"), exactly as you would from any other source.
- Include anything that reads as personal, internal, sensitive, or not directly about the specific status fact needed to answer the question.
- Treat either section as license to say more than the recipient's own question called for.

If nothing in either section is relevant to what was actually asked, ignore both completely and answer from the structured data and the email itself as normal.

WHAT YOU MUST NEVER DO:
- Include banter, jokes, personal remarks, or any engagement with something the sender said that is not a factual or procedural matter about the project itself - a comment about a professional body or qualification, a seminar, a personal aside, a joke at your or Itzik's expense, anything conversational. Acknowledge receipt and address the actual substance of the email; nothing more.
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

ALREADY RESPONDED IN THIS THREAD — DON'T KEEP A CONVERSATION GOING JUST BECAUSE YOU KEEP GETTING REPLIES:
When PRIOR RESPONSES IN THIS THREAD is shown above, you have already replied in this thread at least once. This is a real, confirmed pattern that happened repeatedly on one real day: threads with Maxime, with Gabriel, and others kept extending purely because you kept replying to every further message - a "thanks", a "here's a copy of the revised drawings", a simple FYI - when the conversation had already been properly closed out by your first reply. Being replied to is not, by itself, a reason to reply again.
Once you've already responded in a thread, check the CURRENT email carefully before drafting again:
- If it contains a genuine NEW question, request, or something that actually needs an answer or action from Itzik - respond normally, exactly as you would anywhere else in this brief. A real question always deserves an answer, however many times you've already replied.
- If it's a closing-type message - a thanks, an acknowledgment, "noted", a document or update sent with no question attached, a "here's X for your records" - do not draft a further reply. Output the exact marker <<<SKIP_NOT_ADDRESSED>>> and nothing else. This applies even if the message contains a small new detail (a phone number, a document, a date) - noting new information for Itzik doesn't require an email reply confirming you've noted it every single time; a plain "thank you, noted" is itself often the unnecessary reply, not the correct one, once the thread is already closed out.
The one thing that lifts this caution: if Itzik has personally sent something into the thread since your last reply - check the THREAD HISTORY above for a message labelled "FROM ITZIK (personally)" rather than "FROM NORA (auto-reply)" after your own last reply - the conversation is now his to drive, not yours to keep closing out - respond normally as the current email warrants.

NO GENUINE QUESTION OR REQUEST IN THE CURRENT EMAIL — JUST ACKNOWLEDGE, NOTHING MORE:
Before drafting anything substantive, check whether the CURRENT email actually contains a genuine question, request, or something that needs a decision or action from Itzik. If it does not - it is purely information being passed through, a thank-you, a document sent with no question attached, or conversational remarks with nothing to action - the entire reply should be one brief, plain acknowledgment: confirm receipt and that Itzik will see it (e.g. "Thank you - I'll make sure Itzik gets this."). Do not add anything else - no project update, no process explanation, no status summary - just because the data is available to you; none of that was asked for. This is distinct from ALREADY RESPONDED below, which is about whether to reply again once a thread you've already replied in has been properly closed out - this rule applies to any email, including the first one in a thread, whenever nothing was actually asked.

If there IS a genuine question, answer it from real project data/correspondence wherever you can (see FACTUAL RESOLUTION and GENERAL STATUS UPDATE REQUESTS above) - a confident, fact-based answer is always the right outcome when the data supports it, this rule only restrains what you add on top, not what you're able to answer. Only when a genuine question has no real evidence behind it at all - not even enough for the cautious hedge described in FACTUAL RESOLUTION - should the reply fall back to a plain acknowledgment that it will be passed on to Itzik to come back on, marked <<<NEEDS_FOLLOWUP>>> so a reminder is created; this is a different, broader case than the specific date/document hedge in FACTUAL RESOLUTION; that one still applies as written, unchanged, for a scheduled-date or document-status question.

ADDRESSED TO SOMEONE ELSE — CHECK WHO THE EMAIL IS ACTUALLY FOR, EVERY TIME, BEFORE DRAFTING ANYTHING:
Being on the To: line does not mean an email is addressed to you specifically. When OTHER RECIPIENTS ON THIS EMAIL is shown above, check the current email's own opening greeting - if it says "Dear [someone else's name]" rather than addressing Itzik or the practice, the sender's real, primary addressee is that other person, whatever the formal To:/Cc: split says. This is a genuine, real case that happened and produced a bad outcome: a surveyor's update addressed "Dear Maxime" (the Building Owner) was auto-replied to as "Dear Richard, thank you for your email" - as if it were a private exchange between the practice and the sender, completely ignoring that someone else was the actual addressee. There are exactly three possible outcomes - work out which one applies before writing anything. This is entirely about THIS ONE EMAIL'S OWN CONTENT, not the thread history above it - earlier emails may well have already been answered, by Itzik or by Nora, and are not what decides this:

1. THE CURRENT EMAIL'S GREETING ADDRESSES ITZIK/THE PRACTICE DIRECTLY. Draft and respond normally, as described throughout the rest of this brief.

2. THE CURRENT EMAIL'S GREETING IS TO SOMEONE ELSE, BUT SOMEWHERE IN THE BODY OF THIS SAME EMAIL, A SPECIFIC QUESTION OR REQUEST IS DIRECTED AT ITZIK BY NAME OR ROLE (e.g. "what does Itzik think of this," "can the surveyor confirm," "Itzik, over to you on this point" appearing mid-email even though the greeting itself was to someone else). Draft a response, but answer ONLY that specific question - nothing else about the email, and do not write as though the whole email was addressed to the practice. If that specific question can be answered confidently from the data available, answer it and treat it like any other question in this brief - it does not need special caution just because the surrounding email was addressed to someone else. If it can't be confidently answered, that's an ordinary FACTUAL RESOLUTION case (see above) - use the cautious framing and mark <<<NEEDS_REVIEW>>> for that reason, same as any other unanswerable question.

3. THE CURRENT EMAIL'S GREETING IS TO SOMEONE ELSE, AND NOTHING IN ITS BODY DIRECTS A QUESTION AT ITZIK EITHER. Do not draft a reply at all, regardless of what happened earlier in the thread. Output nothing except the exact marker <<<SKIP_NOT_ADDRESSED>>> and nothing else - no greeting, no body, no sign-off. This is a genuine, absolute rule: being copied into other people's correspondence is not, by itself, ever a reason for the practice to respond.

WHETHER AN AVAILABILITY CONTEXT BLOCK BELONGS IN THE REPLY AT ALL — CHECK THE ORIGINAL EMAIL FIRST:
An AVAILABILITY CONTEXT block being provided does not automatically mean the reply should say "back to you by [time]" or promise any specific return. Look at what the sender's own email actually needed first:
- If the sender asked a question, requested a call, or is genuinely waiting on Itzik personally to do or decide something — then yes, use the availability context to set honest, specific expectations, exactly as described elsewhere in this brief.
- If the sender was simply sending something through with no request attached (e.g. "please see attached," a dictation, a document, an FYI) — nothing was actually asked that needs a promised return time. The correct reply is a brief, plain acknowledgment that it will be passed on ("I will make sure Itzik receives this") — do NOT add "he's currently out" or "back to you by [time]" onto it. Stating a return time nobody asked for reads as a non sequitur, not as helpful information.
Get this distinction from the sender's own words, not from whether an AVAILABILITY CONTEXT block happens to be present.

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
When someone emails asking what the process actually is (how party wall notices work, what happens after a notice is served, what their options are), read the thread for context first, then explain the process in full, in this order.

Write the four notice options as a genuine numbered list — each option on its own line, starting "1. ", "2. ", "3. ", "4. " — never merged into one flowing paragraph:
1. Consent, with no further action needed.
2. Consent, subject to a Schedule of Condition being carried out on their property first.
3. Dissent, and appoint Itzik as the "agreed surveyor" acting for both parties.
4. Dissent, and appoint their own separate surveyor. In this case, the Building Owner is responsible for both Itzik's fees and the reasonable fees of the Adjoining Owner's own appointed surveyor.

Do not state any fee figures, quotes, or pricing at this stage, under any circumstances. Say Itzik will come back to them directly with pricing — this defers the pricing itself, not the rest of the explanation, and should be marked <<<NEEDS_FOLLOWUP>>> for that reason (see TWO DIFFERENT MARKERS below) — it does not need <<<NEEDS_REVIEW>>>, since none of this explanation is a guess.

Timescales, explained precisely, not vaguely:
- The Adjoining Owner has 14 days to respond to the initial notice.
- If nothing is heard within that 14 days, they are by default deemed to have dissented.
- At that point, a Section 10 notice is served, giving a further 10 days to either appoint Itzik as the agreed surveyor, or appoint their own surveyor.
- If the Adjoining Owner does neither within that further 10 days, the practice will appoint a surveyor on their behalf. Always include this specific clarification when explaining that step: this appointed surveyor cannot be Itzik — an agreed surveyor has to be agreed between both parties, and in the absence of agreement under Section 10, a separate surveyor is appointed specifically to act for the Adjoining Owner. Itzik can suggest someone the practice has worked with before whose fees are reasonable, and the two surveyors then work together to get the award finalised.

Explain this warmly and in plain language, not as a dense legal recitation — this is someone trying to understand what they're being asked to do, not reading a statute. The numbered list of options should read as a genuine list; the surrounding explanation should still read as natural prose, not a bullet-pointed legal document throughout.

ADDRESSING THE RECIPIENT — "BUILDING OWNER" / "ADJOINING OWNER" ARE TERMS OF ART, NOT HOW YOU SPEAK TO SOMEONE:
These terms exist to distinguish parties on paper, not to describe someone to their own face. When writing directly to the person who IS the Building Owner (most commonly Itzik's own client, e.g. explaining the process to them), address them as "you" throughout, the same way anyone would write to the actual person they're emailing — never refer to them in the third person as "the Building Owner" as if they were someone else. If the term genuinely needs to appear for legal precision (e.g. explaining what the Act itself calls them, or a fee point that only makes sense using the term), qualify it plainly the first time — "you, as the Building Owner, ..." or "you (the Building Owner) ..." — not a bare, unexplained "the Building Owner" as though the recipient already knows the jargon and needs it repeated back at them. The same applies when writing directly to an Adjoining Owner. Only use the bare term, unqualified, when writing to someone ELSE about that party — e.g. a surveyor, or the other side, where "the Building Owner" correctly refers to a third person, not the recipient themselves.

PARTY WALL CONTEXT — GENERAL:
Itzik Darel is primarily a party wall surveyor but also handles general construction consultancy. Do not assume every email is party wall related. Read the email and thread carefully — if it is clearly about party wall matters, use your knowledge of the Party Wall etc. Act 1996 to respond accurately. If it is about something else (construction disputes, general surveying, CDM, building contracts), respond appropriately to that context instead. If the context is unclear or there is no project data available, give a professional acknowledgement and say Itzik will be in touch to discuss further — do not guess or assume what the matter relates to.`;

        // Added 2026-09-23, on request, real confirmed pattern: several
        // threads today (Maxime, Gabriel, others) kept extending purely
        // because Nora kept replying to every "thanks"/"here's a copy
        // of X"/simple FYI message, when the conversation had already
        // been properly closed out. Once Nora has already responded in
        // a thread, and Itzik hasn't personally sent anything since,
        // she should not keep replying to every further message unless
        // it contains a genuine new question - see the brain rule this
        // feeds. email_auto_drafts is the reliable record of every
        // reply Nora has actually sent (both auto-sent and Itzik-
        // reviewed-then-sent), since emails itself has no equivalent
        // flag on outgoing rows distinguishing Nora's own text from
        // Itzik's.
        let priorResponseContext = '';
        if (email.thread_id) {
          const { data: priorSent } = await supabase
            .from('email_auto_drafts')
            .select('id')
            .eq('thread_id', email.thread_id)
            .eq('status', 'sent');
          const priorCount = (priorSent || []).length;
          if (priorCount > 0) {
            priorResponseContext = '\n\nPRIOR RESPONSES IN THIS THREAD - Nora has already sent ' + priorCount + ' repl' + (priorCount === 1 ? 'y' : 'ies') + ' in this thread already (see the ALREADY RESPONDED brain rule before drafting another).';
          }
        }

        // Added 2026-09-22, on request, real confirmed case: Richard
        // Morse's email was addressed "Dear Maxime" and listed Maxime
        // as a co-recipient, with the practice's own address also on
        // the To: line but not the one being spoken to - Nora replied
        // "Dear Richard... thank you for YOUR email" as if it were a
        // private one-to-one exchange with the practice, completely
        // missing that Maxime was the actual primary addressee. The
        // drafting context never even included who else the email was
        // sent to, so the model had no way to know. Now it does.
        const otherToRecipients = (email.to_email || '')
          .split(/[;,]/)
          .map(a => a.trim())
          .filter(a => a && !a.toLowerCase().includes('sq1consulting'));
        const ccRecipients = (email.cc_emails || '')
          .split(/[;,]/)
          .map(a => a.trim())
          .filter(Boolean);
        const recipientContext = (otherToRecipients.length || ccRecipients.length)
          ? '\n\nOTHER RECIPIENTS ON THIS EMAIL - check carefully whether this email is actually addressed to you at all (see the ADDRESSED TO SOMEONE ELSE brain rule):' +
            (otherToRecipients.length ? '\nAlso in To: ' + otherToRecipients.join(', ') : '') +
            (ccRecipients.length ? '\nCc: ' + ccRecipients.join(', ') : '')
          : '';

        const userPrompt = 'FROM: ' + (email.sender_name || email.sender_email) +
          '\nSUBJECT: ' + email.subject +
          '\nEMAIL BODY:\n' + plainTextBody(email).slice(0, 6000) +
          recipientContext +
          (projectContext ? '\n\n' + projectContext : '') +
          (priorResponseContext) +
          (eligibility.framing ? '\n\nAVAILABILITY CONTEXT (this is why a response is going out now rather than Itzik replying personally - see the brain rule on when this belongs in the reply at all):\n' + eligibility.framing : '');

        // Jiten Wagjiani running joke override - see the constants
        // block at the top of this file. Only fires when the reply is
        // specifically triggered by Itzik being unavailable right now
        // (reason 'soc' or 'meeting' - the exact moment the joke is
        // about), so it never surfaces on an ordinary silence-gated
        // reply to him. Bypasses the Terra call entirely - fixed,
        // pre-approved wording, not per-call generation - but still
        // goes through the normal draft-save / auto-send pipeline
        // below like any other reply.
        const isJitenAvailabilityMoment = JITTEN_JOKE_ENABLED &&
          (email.sender_email || '').toLowerCase() === JITTEN_EMAIL &&
          (eligibility.reason === 'soc' || eligibility.reason === 'meeting');

        let rawDraftBody;
        if (isJitenAvailabilityMoment) {
          // Built directly here, not from eligibility.framing - that
          // field is written as an instruction FOR Terra to turn into
          // prose (e.g. "Say he will call back. Do not describe what
          // kind of meeting."), not as literal reader-facing text, so
          // it must never be sent to a real recipient as-is.
          const firstName = (email.sender_name || '').split(' ')[0] || 'Jiten';
          const jokeLine = pickJitenJokeLine(email.id);
          const availabilityLine = eligibility.reason === 'soc'
            ? "Itzik is currently out on a Schedule of Condition inspection and will be back in touch with you as soon as he's free."
            : "Itzik is in a meeting right now and will get back to you as soon as he's out.";
          const backAndForthLine = eligibility.sameDayBackAndForth
            ? "I can see he's been in touch with you already today - "
            : '';
          rawDraftBody = `Hi ${firstName},\n\n${jokeLine} ${backAndForthLine}${availabilityLine}\n\nKind regards,\nNora\nOn behalf of Itzik Darel`;
        } else {
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
          rawDraftBody = aiData.choices?.[0]?.message?.content || '';
        }
        if (!rawDraftBody) throw new Error('Empty draft');

        // Added 2026-09-22, on request: a third, distinct outcome from
        // the two markers below - "never addressed at all" needs to
        // skip creating a draft entirely, not just hold one back for
        // review. Checked BEFORE the other two markers specifically
        // because if the model determines it was never addressed
        // anywhere in the thread, nothing else about the draft matters -
        // there should be no draft.
        if (rawDraftBody.includes('<<<SKIP_NOT_ADDRESSED>>>')) {
          results.skipped++;
          continue;
        }

        // Fixed 2026-09-12: the <<<NEEDS_FOLLOWUP>>> marker must never
        // reach the actual saved draft — it would show up in the
        // email text itself, and get sent to the recipient if used
        // as-is. Detected here, then stripped before saving.
        //
        // Split into two distinct markers 2026-09-20, on request: a
        // real, confirmed design flaw - a draft that correctly,
        // deliberately deferred pricing (accurate, nothing at risk of
        // being wrong) was being held back from auto-sending for
        // exactly the same reason as a draft that was genuinely
        // guessing at something it didn't have data for (content that
        // really could be wrong). Those are different questions -
        // "does Itzik still have work to do" vs "is this safe to send
        // unreviewed" - and only the second should ever gate sending.
        // NEEDS_FOLLOWUP still creates a reminder task, but no longer
        // blocks auto-send by itself; NEEDS_REVIEW is what blocks it
        // now. See the brain's own TWO DIFFERENT MARKERS section.
        const draftNeedsFollowup = rawDraftBody.includes('<<<NEEDS_FOLLOWUP>>>');
        const draftNeedsReview = rawDraftBody.includes('<<<NEEDS_REVIEW>>>');
        const draftBody = rawDraftBody
          .replace('<<<SKIP_NOT_ADDRESSED>>>', '')
          .replace('<<<NEEDS_FOLLOWUP>>>', '')
          .replace('<<<NEEDS_REVIEW>>>', '')
          .trim();

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
                { role: 'user', content: 'EMAIL FROM: ' + (email.sender_name || email.sender_email) + '\nSUBJECT: ' + email.subject + '\nBODY: ' + plainTextBody(email).slice(0, 2000) + '\n\n' + (projectContext || '') },
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
        // the draft's own content reliability - a draft whose content
        // itself might be wrong (<<<NEEDS_REVIEW>>>) always waits for
        // Itzik personally, regardless of the setting. A draft that
        // merely still needs a follow-up task (<<<NEEDS_FOLLOWUP>>>,
        // e.g. deferred pricing) is NOT held back - it's accurate as
        // written, so it sends normally; the task is a separate,
        // parallel thing, not a block. Any failure here leaves the
        // already-saved draft exactly as if auto-send were off -
        // never a false "sent" state.
        let autoSent = false;
        if (autoSendEnabled && !draftNeedsReview) {
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
            const { data: integ } = await supabase.from('user_integrations').select('email_provider').eq('user_id', ownerUserId).limit(1).maybeSingle();
            const isGmail = integ?.email_provider === 'gmail';

            const { data: sendData, error: sendError } = await supabase.functions.invoke(
              isGmail ? 'send_email_via_gmail' : 'send_email_via_microsoft',
              { body: {
                user_id: isGmail ? ownerUserId : (email.user_id || null),
                to_email: email.sender_email,
                subject: 'Re: ' + (email.subject || ''),
                body: toHtmlForSend(draftBody),
                reply_to_message_id: email.id,
              } }
            );

            if (sendError || sendData?.error) throw new Error(sendError?.message || sendData?.error || 'Send failed');

            const respondedAt = new Date().toISOString();
            await supabase.from('emails').insert({
              subject: 'Re: ' + (email.subject || ''),
              body: toHtmlForSend(draftBody),
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

            // Fixed 2026-10-01, on request: this used to fire
            // unconditionally alongside the <<<NEEDS_FOLLOWUP>>>
            // reminder above, so a reply Nora fully and correctly
            // answered from real evidence got a redundant pair of
            // to-do items for the same email. On request: when she's
            // answered it herself, the only thing needed is a review
            // task; when she couldn't and just acknowledged, the
            // follow-up reminder above already covers it - creating
            // both for the same email is noise, not two real tasks.
            if (ownerUserId && !draftNeedsFollowup) {
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

// Named exports for the pure/testable pieces of the eligibility and
// Jiten-joke logic above - added 2026-09-28 alongside those changes so
// they have real regression coverage (see
// api/lib/__tests__/cron-auto-draft-eligibility.test.js). The default
// export (the cron handler itself) and its Vercel config are
// unaffected; these are additional, not replacements.
export {
  computeSendEligibility,
  computeSameDayBackAndForth,
  computeSilenceFallback,
  findSameAppointmentMatch,
  pickJitenJokeLine,
  JITTEN_EMAIL,
  JITTEN_JOKE_LINES,
  JITTEN_JOKE_ENABLED,
  JITTEN_ONE_OFF_ENABLED,
  JITTEN_ONE_OFF_LINE,
  JITTEN_ONE_OFF_MARKER,
  htmlToPlainText,
  stripDisclaimerBoilerplate,
  plainTextBody,
};
