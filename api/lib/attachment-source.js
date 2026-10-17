// Where an email attachment's actual bytes come from.
//
// Found 2026-10-15: save/summarise read attachments from a Supabase storage
// bucket called "email-attachments". That bucket does not exist and none of the
// 1,126 attachment rows has a stored file, so every save/summarise failed. The
// working path in this app (api/attachment-url.js, the paperclip chips) fetches
// the attachment live from Microsoft Graph using the ids stored on the row, so
// that is the primary source here; storage is only a fallback for any row that
// genuinely has a stored copy.

// Gmail attachments are recorded as attachment_external_id = 'gmail:<messageId>:<partId>'
// (see sync-gmail.js). Gmail's own attachment ids are not stable between fetches,
// so the part is located again by partId each time and its current id used.
function findGmailPart(payload, partId) {
  if (!payload) return null;
  if (String(payload.partId) === String(partId)) return payload;
  for (const p of payload.parts || []) {
    const hit = findGmailPart(p, partId);
    if (hit) return hit;
  }
  return null;
}

async function loadGmailAttachment(att, gmailToken) {
  if (!gmailToken) throw new Error('Your Gmail account is not connected or needs reconnecting');
  const [, messageId, partId] = String(att.attachment_external_id).split(':');
  const auth = { Authorization: `Bearer ${gmailToken}` };
  const mr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, { headers: auth });
  if (!mr.ok) throw new Error(mr.status === 404 ? 'Gmail no longer has this message (it may have been deleted)' : `Gmail refused the download (${mr.status})`);
  const msg = await mr.json();
  const part = findGmailPart(msg.payload, partId);
  if (!part) throw new Error('Could not find this attachment in the Gmail message');
  let data = part.body?.data;
  if (!data && part.body?.attachmentId) {
    const ar = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, { headers: auth });
    if (!ar.ok) throw new Error(`Gmail refused the download (${ar.status})`);
    data = (await ar.json()).data;
  }
  if (!data) throw new Error('Gmail returned no data for this attachment');
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export async function loadAttachmentBuffer({ sb, att, token, gmailToken }) {
  if (String(att?.attachment_external_id || '').startsWith('gmail:')) {
    return loadGmailAttachment(att, gmailToken);
  }
  const problems = [];

  if (token && att.email_external_id && att.attachment_external_id) {
    const url = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(att.email_external_id)}/attachments/${encodeURIComponent(att.attachment_external_id)}/$value`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      problems.push(r.status === 404
        ? 'Outlook no longer has this message or attachment (it may have been moved or deleted)'
        : `Outlook refused the download (${r.status})`);
    } catch (e) {
      problems.push(`Could not reach Outlook (${e.message})`);
    }
  } else if (!token) {
    problems.push('Your Outlook account is not connected or needs reconnecting');
  } else {
    problems.push('This attachment has no Outlook reference stored');
  }

  if (sb && att.storage_path) {
    try {
      const { data, error } = await sb.storage.from('email-attachments').download(att.storage_path);
      if (!error && data) return Buffer.from(await data.arrayBuffer());
    } catch { /* fall through to the error below */ }
  }

  throw new Error(problems[0] || 'Could not get this attachment');
}
