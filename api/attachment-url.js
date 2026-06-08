// api/attachment-url.js
// Fetches an email attachment directly from Microsoft Graph and serves it
import { getValidMicrosoftToken } from './onedrive-helper.js';

export default async function handler(req, res) {
  const { email_id, att_id, filename, content_type } = req.query;

  if (!email_id || !att_id) {
    return res.status(400).json({ error: 'email_id and att_id required' });
  }

  try {
    const token = await getValidMicrosoftToken('help@sq1consulting.co.uk');
    if (!token) return res.status(401).send('Microsoft authentication required. Please reconnect your email in Settings.');

    const graphUrl = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(email_id)}/attachments/${encodeURIComponent(att_id)}/$value`;

    const response = await fetch(graphUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[attachment-url] Graph error:', response.status, errText);
      return res.status(response.status).send(`Could not fetch attachment (${response.status})`);
    }

    const ct = content_type || response.headers.get('content-type') || 'application/octet-stream';
    const fn = (filename || 'attachment').replace(/[^\w.\-() ]/g, '_');

    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', `inline; filename="${fn}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const buffer = Buffer.from(await response.arrayBuffer());
    return res.send(buffer);

  } catch (err) {
    console.error('[attachment-url]', err.message);
    return res.status(500).send(`Error: ${err.message}`);
  }
}
