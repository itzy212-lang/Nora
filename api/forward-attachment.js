// api/forward-attachment.js
//
// Added 2026-10-16: when the user hits Forward, the original email's
// attachments were never loaded into the composer, so they were silently
// dropped. This returns ONE attachment as base64 (fetched live from Outlook via
// loadAttachmentBuffer) in the same {name,type,size,base64} shape the
// composer's own "Attach" button produces, so the normal send path carries it.
// One file per call keeps each response under Vercel's 4.5 MB limit.

import { createClient } from '@supabase/supabase-js';
import { getValidMicrosoftToken } from './onedrive-helper.js';
import { loadAttachmentBuffer } from './lib/attachment-source.js';

// base64 inflates by a third; stay safely under the 4.5 MB response limit.
export const MAX_FORWARD_BYTES = 3 * 1024 * 1024;

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
    const { user_id, attachment_id } = req.body || {};
    if (!user_id || !attachment_id) return res.status(400).json({ error: 'user_id and attachment_id are required' });

    const token = await getValidMicrosoftToken(user_id);
    if (!token) return res.status(401).json({ error: 'Your Outlook account is not connected or needs reconnecting.' });

    const sb = getSupabase();
    const { data: att, error } = await sb
      .from('email_attachments')
      .select('id, filename, content_type, size_bytes, storage_path, email_external_id, attachment_external_id')
      .eq('id', attachment_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    if (Number(att.size_bytes) > MAX_FORWARD_BYTES) {
      return res.status(413).json({ error: 'Too large to forward from here (over 3 MB) - attach it manually', name: att.filename });
    }
    const buffer = await loadAttachmentBuffer({ sb, att, token });
    if (buffer.length > MAX_FORWARD_BYTES) {
      return res.status(413).json({ error: 'Too large to forward from here (over 3 MB) - attach it manually', name: att.filename });
    }
    return res.status(200).json({
      name: att.filename || 'attachment',
      type: att.content_type || 'application/octet-stream',
      size: buffer.length,
      base64: buffer.toString('base64'),
    });
  } catch (err) {
    console.error('[forward-attachment] failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
