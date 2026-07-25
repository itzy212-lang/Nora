// api/onedrive-download.js
// Fetches a OneDrive file by item_id and returns it as base64
// Used by the email composer to attach project documents
import { getValidMicrosoftToken } from './onedrive-helper.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { item_id, user_id } = req.query;
  if (!item_id) return res.status(400).json({ error: 'item_id required' });

  try {
    const token = await getValidMicrosoftToken(user_id || 'help@sq1consulting.co.uk');
    if (!token) return res.status(401).json({ error: 'Microsoft authentication required' });

    // Fetch file metadata first (to get mime type and name)
    const metaRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(item_id)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!metaRes.ok) {
      const err = await metaRes.text().catch(() => '');
      console.error('[onedrive-download] metadata error:', metaRes.status, err);
      return res.status(metaRes.status).json({ error: `Could not fetch file metadata (${metaRes.status})` });
    }
    const meta = await metaRes.json();
    const mimeType = meta.file?.mimeType || 'application/octet-stream';
    const fileName = meta.name || 'attachment';

    // Fetch file content
    const contentRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(item_id)}/content`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!contentRes.ok) {
      const err = await contentRes.text().catch(() => '');
      console.error('[onedrive-download] content error:', contentRes.status, err);
      return res.status(contentRes.status).json({ error: `Could not fetch file content (${contentRes.status})` });
    }

    const buffer = Buffer.from(await contentRes.arrayBuffer());
    const base64 = buffer.toString('base64');

    return res.status(200).json({ success: true, name: fileName, mimeType, base64 });

  } catch (err) {
    console.error('[onedrive-download] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
