// One rule, used by the AO card, the project list and the dashboard so they always agree:
// an adjoining owner who was added but has had nothing done (no notice served) for 7 days needs action.
// Returns the number of days since the owner was added, or null when the rule does not apply.
export const NO_NOTICE_DAYS = 7;

const MOVED_ON = ['consent', 'dissent', 'notice_served', 's10', 'section_10_served', 's104b', 'award', 'complete', 'award_served', 'surveyor_appointed', 'appointed_ao'];

export function aoNoNoticeDays(ao, projectCreatedAt = null, now = Date.now()) {
  if (!ao) return null;
  const st = String(ao.status || ao.ao_status || '').toLowerCase();
  if (MOVED_ON.includes(st) || ao.appointed_by_me) return null;
  const anyDone = [
    ao.notice_served_date, ao.noticeServedDate, ao.ao_notice_served_date,
    ao.consent_deadline, ao.consentDeadline, ao.ao_consent_deadline,
    ao.s10_served_date, ao.s10ServedDate, ao.s104b_served_date, ao.s104bServedDate,
    ao.award_served_date, ao.awardServedDate, ao.award_generated_at, ao.awardGeneratedAt,
  ].some(Boolean);
  if (anyDone) return null;
  const added = new Date(ao.added_at || ao.created_at || projectCreatedAt || 0).getTime();
  if (!(added > 0)) return null;
  const days = Math.floor((now - added) / 86400000);
  return days >= NO_NOTICE_DAYS ? days : null;
}
