// When did anything last genuinely move on this adjoining owner?
//
// Added 2026-10-13. The "No progress - Nd" badge, the project list's red/amber
// colour and the daily briefing all used ao.last_status_change alone, which is
// only stamped when the AO's *status* field is changed by hand. Booking or
// carrying out a Schedule of Condition, serving a Section 10 notice, receiving
// consent etc. never touched it, so a job with a Schedule of Condition done
// 8 days ago showed "No progress - 76d".
//
// Progress = the latest of: the last status change, any dated milestone on the
// record (notice, Section 10, 10(4)(b), consent, award), and the Schedule of
// Condition. A Schedule of Condition dated in the FUTURE (booked) counts as
// progress right now - the job is not stalled while a visit is booked.
//
// NOTE: api/lib/aoProgress.js is a copy of this file (serverless functions
// cannot import from src/). Keep them identical - a test checks parity.

const MILESTONE_KEYS = [
  'last_status_change',
  'notice_served_date', 'noticeServedDate',
  's10_served_date', 's10ServedDate',
  's104b_served_date', 's104bServedDate',
  'consent_received_date', 'consentReceivedDate',
  'agreed_surveyor_updated_at',
  'award_generated_at', 'awardGeneratedAt',
  'award_served_date', 'awardServedDate',
];
const SOC_KEYS = ['soc_agreed_date', 'soc_date', 'schedule_of_condition_date', 'socAgreedDate', 'socDate'];

function toTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function lastProgressTime(ao, now = Date.now()) {
  if (!ao) return null;
  const times = [];
  for (const k of MILESTONE_KEYS) {
    const t = toTime(ao[k]);
    if (t !== null && t <= now) times.push(t);
  }
  for (const k of SOC_KEYS) {
    const t = toTime(ao[k]);
    if (t === null) continue;
    // A visit already carried out counts from its date; a visit still to come
    // (booked) means the job is live right now.
    times.push(t > now ? now : t);
  }
  return times.length ? Math.max(...times) : null;
}

export function daysSinceProgress(ao, now = Date.now()) {
  const t = lastProgressTime(ao, now);
  return t === null ? null : Math.floor((now - t) / 86400000);
}
