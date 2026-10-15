// api/save-attachments-to-onedrive.js
//
// Added 2026-10-15, on request: from an open email, pick attachments and a
// destination folder inside the project's OneDrive folder, and save them in one
// click. Everything happens on the server (stored copy -> OneDrive), so the
// browser never has to carry the file as base64 - the old two-step flow
// (attachment-base64 -> browser -> onedrive-upload) broke on anything near
// Vercel's 4.5 MB request/response limit.

import { createClient } from '@supabase/supabase-js';
import { getValidMicrosoftToken } from './onedrive-helper.js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

async function putToFolder({ token, folderId, name, buffer, mimeType }) {
  const base = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}:/${encodeURIComponent(name)}:`;
  if (buffer.length <= SIMPLE_UPLOAD_LIMIT) {
    const r = await fetch(`${base}/content`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType },
      body: buffer,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error?.message || `OneDrive upload failed (${r.status})`);
    return d;
  }
  const s = await fetch(`${base}/createUploadSession`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name } }),
  });
  const session = await s.json().catch(() => ({}));
  if (!s.ok || !session.uploadUrl) throw new Error(session?.error?.message || `Could not start upload (${s.status})`);
  const chunk = 3276800; // 10 x 320 KiB, as Graph requires multiples of 320 KiB
  let offset = 0;
  let item = null;
  while (offset < buffer.length) {
    const end = Math.min(offset + chunk, buffer.length);
    const part = buffer.subarray(offset, end);
    const r = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(part.length), 'Content-Range': `bytes ${offset}-${end - 1}/${buffer.length}` },
      body: part,
    });
    if (r.status === 200 || r.status === 201) item = await r.json().catch(() => ({}));
    else if (r.status !== 202) throw new Error(`Upload chunk failed (${r.status})`);
    offset = end;
  }
  return item || {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user_id, folder_id, attachment_ids } = req.body || {};
    if (!user_id || !folder_id || !Array.isArray(attachment_ids) || !attachment_ids.length) {
      return res.status(400).json({ error: 'user_id, folder_id and attachment_ids are required' });
    }
    if (attachment_ids.length > 25) return res.status(400).json({ error: 'Too many attachments in one go (max 25)' });

    const token = await getValidMicrosoftToken(user_id);
    if (!token) return res.status(401).json({ error: 'Your OneDrive/Outlook account is not connected or needs reconnecting.' });

    const sb = getSupabase();
    const { data: atts, error } = await sb
      .from('email_attachments')
      .select('id, filename, content_type, storage_path')
      .in('id', attachment_ids);
    if (error) throw new Error(error.message);

    const results = [];
    for (const id of attachment_ids) {
      const att = (atts || []).find((a) => a.id === id);
      if (!att) { results.push({ id, ok: false, error: 'Attachment not found' }); continue; }
      try {
        const { data: file, error: dlErr } = await sb.storage.from('email-attachments').download(att.storage_path);
        if (dlErr || !file) throw new Error('Could not read the stored copy of this attachment');
        const buffer = Buffer.from(await file.arrayBuffer());
        const name = String(att.filename || 'attachment').replace(/[\\/:*?"<>|]/g, '-').trim() || 'attachment';
        const item = await putToFolder({
          token, folderId: folder_id, name, buffer,
          mimeType: att.content_type || 'application/octet-stream',
        });
        results.push({ id, ok: true, name: item.name || name, web_url: item.webUrl || null });
      } catch (err) {
        console.error('[save-attachments-to-onedrive] failed for', id, err.message);
        results.push({ id, ok: false, name: att.filename, error: err.message });
      }
    }
    const saved = results.filter((r) => r.ok).length;
    return res.status(200).json({ success: saved > 0, saved, failed: results.length - saved, results });
  } catch (err) {
    console.error('[save-attachments-to-onedrive] failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
