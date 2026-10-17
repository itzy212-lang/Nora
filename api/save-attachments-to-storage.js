// api/save-attachments-to-storage.js
//
// Replaces save-attachments-to-onedrive.js (2026-10-17): the Save button must work
// the same for every account. Attachments are read from the user's mail provider
// (Outlook or Gmail) and written to the folder chosen in their storage (OneDrive
// or Google Drive). Everything happens server-side, so the browser never carries
// the file. POST {user_id (email), user_uuid, folder_id, attachment_ids[<=25]}
import { createClient } from '@supabase/supabase-js';
import { getValidMicrosoftToken } from './onedrive-helper.js';
import { getProviderContext } from './lib/provider-context.js';
import { getStorageAdapter } from './lib/storage-adapter.js';
import { getGoogleToken } from './lib/google-auth.js';
import { loadAttachmentBuffer } from './lib/attachment-source.js';

const sbClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user_id, user_uuid, folder_id, attachment_ids } = req.body || {};
    if ((!user_id && !user_uuid) || !folder_id || !Array.isArray(attachment_ids) || !attachment_ids.length) {
      return res.status(400).json({ error: 'user_id, folder_id and attachment_ids are required' });
    }
    if (attachment_ids.length > 25) return res.status(400).json({ error: 'Too many attachments in one go (max 25)' });

    const sb = sbClient();
    const ctx = await getProviderContext({ sb, userEmail: user_id, userUuid: user_uuid });
    const storage = await getStorageAdapter(ctx);
    const token = await getValidMicrosoftToken(user_id).catch(() => null);
    const gmailToken = ctx.mail === 'gmail' ? await getGoogleToken(sb, ctx.integ, 'gmail') : null;

    const { data: atts, error } = await sb
      .from('email_attachments')
      .select('id, filename, content_type, storage_path, email_external_id, attachment_external_id')
      .in('id', attachment_ids);
    if (error) throw new Error(error.message);

    const results = [];
    for (const id of attachment_ids) {
      const att = (atts || []).find((a) => a.id === id);
      if (!att) { results.push({ id, ok: false, error: 'Attachment not found' }); continue; }
      try {
        const buffer = await loadAttachmentBuffer({ sb, att, token, gmailToken });
        const name = String(att.filename || 'attachment').replace(/[\\/:*?"<>|]/g, '-').trim() || 'attachment';
        const item = await storage.upload(folder_id, name, buffer, att.content_type || 'application/octet-stream');
        results.push({ id, ok: true, name: item.name || name, web_url: item.webUrl || null });
      } catch (err) {
        console.error('[save-attachments-to-storage] failed for', id, err.message);
        results.push({ id, ok: false, name: att.filename, error: err.message });
      }
    }
    const saved = results.filter((r) => r.ok).length;
    return res.status(200).json({ success: saved > 0, saved, failed: results.length - saved, provider: storage.provider, results });
  } catch (err) {
    console.error('[save-attachments-to-storage] failed:', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
}
