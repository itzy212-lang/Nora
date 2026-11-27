// src/utils/postTrackedLetter.js
//
// Front-end call that posts a finished notice pack as a Tracked letter (api/send-tracked-letter.js).
// Used by "Save & Post" on the notice Finalise dialog. The page count and the price are worked out on
// the server from the PDF itself; expectedPricePence is what the user was shown, and the server refuses
// to send if it no longer matches. Provider-neutral: no email or storage provider is involved.
import sb from '../supabaseClient';

export async function postTrackedLetter({ pdfB64, project, ao, name, line, postcode, expectedPricePence, fileName, noticeId }) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch('/api/send-tracked-letter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({
      pdf_b64: pdfB64, project_id: project?.id, ao_id: ao?.id || ao?.num || '', recipient_name: name,
      address_line: line, postcode, expected_price_pence: expectedPricePence, file_name: fileName || 'notice.pdf', notice_id: noticeId || undefined,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'The letter could not be sent');
  window.dispatchEvent(new CustomEvent('ely:refresh-project-detail'));
  return json;
}
