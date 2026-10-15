// Where an email attachment's actual bytes come from.
//
// Found 2026-10-15: save/summarise read attachments from a Supabase storage
// bucket called "email-attachments". That bucket does not exist and none of the
// 1,126 attachment rows has a stored file, so every save/summarise failed. The
// working path in this app (api/attachment-url.js, the paperclip chips) fetches
// the attachment live from Microsoft Graph using the ids stored on the row, so
// that is the primary source here; storage is only a fallback for any row that
// genuinely has a stored copy.

export async function loadAttachmentBuffer({ sb, att, token }) {
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
