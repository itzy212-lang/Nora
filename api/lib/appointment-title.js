// Title for an auto-booked calendar event. The model is asked to name the real
// kind of appointment (inspection, site visit, meeting, call...). If it gives
// nothing usable we fall back to a neutral title, never "Call with", because
// most booked appointments are site visits, not calls.
export function appointmentTitle(appt, email) {
  const t = String(appt?.title || '').trim();
  if (t && t.toLowerCase() !== 'null') return t.slice(0, 120);
  const subject = String(email?.subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim();
  if (subject) return subject.slice(0, 120);
  return 'Appointment with ' + (email?.sender_name || email?.sender_email || 'contact');
}
