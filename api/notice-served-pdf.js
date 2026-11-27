// api/notice-served-pdf.js
//
// POST /api/notice-served-pdf  { notice_id }   (Authorization: Bearer <user token>)
// Returns the exact PDF that was served for a notice, as base64, so a hard copy can be posted later.
// The copy is kept in Nora's own storage when a notice is served (api/notice-response-activate.js), so this
// does not depend on the user's mail or storage provider. Only the notice's owner can read it.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const h = req.headers?.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user?.id) return res.status(401).json({ error: 'Not signed in' });

  const noticeId = String(req.body?.notice_id || '');
  if (!noticeId) return res.status(400).json({ error: 'No notice given' });
  const { data: notice } = await supabase.from('notices').select('id').eq('id', noticeId).eq('user_id', user.id).maybeSingle();
  if (!notice) return res.status(404).json({ error: 'Notice not found' });

  const { data: archive } = await supabase.from('notice_response_archives').select('pdf_bucket, pdf_path').eq('notice_id', noticeId).maybeSingle();
  if (!archive?.pdf_path) return res.status(404).json({ error: 'No saved copy of this notice is available' });
  const { data: file, error } = await supabase.storage.from(archive.pdf_bucket || 'documents').download(archive.pdf_path);
  if (error || !file) return res.status(404).json({ error: 'The saved copy could not be read' });
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'The saved copy is too large to reopen here' });
  return res.status(200).json({ pdf_b64: buf.toString('base64') });
}
