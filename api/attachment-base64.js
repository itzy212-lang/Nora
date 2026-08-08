// api/attachment-base64.js
//
// New endpoint (2026-08-08), part of the attachment save/summarize
// feature. Returns an attachment's raw file content as base64, for the
// OneDrive save action. Deliberately reuses the exact same storage
// download already proven working in fetch-attachment.js, rather than
// fetching fresh from Microsoft Graph (avoids URL-expiry/CORS issues
// with the temporary Graph download links used elsewhere for viewing).

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { attachment_id } = req.body || {};
    if (!attachment_id) return res.status(400).json({ error: 'attachment_id is required' });

    const sb = getSupabase();
    const { data: attachment, error: attErr } = await sb
      .from('email_attachments')
      .select('id, filename, content_type, storage_path')
      .eq('id', attachment_id)
      .maybeSingle();
    if (attErr || !attachment) return res.status(404).json({ error: 'Attachment not found' });

    const { data: fileData, error: dlErr } = await sb.storage
      .from('email-attachments')
      .download(attachment.storage_path);
    if (dlErr || !fileData) return res.status(500).json({ error: 'Could not download attachment' });

    const buffer = Buffer.from(await fileData.arrayBuffer());
    return res.status(200).json({
      ok: true,
      filename: attachment.filename,
      content_type: attachment.content_type,
      content_base64: buffer.toString('base64'),
    });
  } catch (err) {
    console.error('[attachment-base64] failed:', err.message);
    return res.status(500).json({ error: 'Failed to fetch attachment', detail: err.message });
  }
}
