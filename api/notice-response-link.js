import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';

const hash = input => createHash('sha256').update(input).digest('hex');
function serverClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server configuration missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function json(res, status, body) { return res.status(status).json(body); }
const allowedBuckets = new Set(['project-files', 'documents', 'notice-pdfs']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const auth = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
    if (!auth) return json(res, 401, { error: 'Authentication required' });
    const sb = serverClient();
    const { data: { user }, error: authError } = await sb.auth.getUser(auth[1]);
    if (authError || !user) return json(res, 401, { error: 'Invalid session' });
    const { noticeId, bucket, path } = req.body || {};
    if (typeof noticeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(noticeId) ||
        !allowedBuckets.has(bucket) || typeof path !== 'string' || !path || path.includes('..'))
      return json(res, 400, { error: 'Invalid notice or PDF location' });
    const { data: notice, error: noticeError } = await sb.from('notices')
      .select('id,user_id,status,section_1,section_2,section_3,section_6,section_10')
      .eq('id', noticeId).eq('user_id', user.id).single();
    if (noticeError || !notice) return json(res, 404, { error: 'Notice not found' });
    if (notice.status !== 'served') return json(res, 409, { error: 'Only served notices can have response links' });
    const { data: pdf, error: fileError } = await sb.storage.from(bucket).download(path);
    if (fileError || !pdf || pdf.type !== 'application/pdf')
      return json(res, 400, { error: 'Original served PDF was not found' });
    const bytes = Buffer.from(await pdf.arrayBuffer());
    if (bytes.length < 10 || bytes.subarray(0, 5).toString() !== '%PDF-')
      return json(res, 400, { error: 'Invalid PDF file' });
    const digest = hash(bytes);
    const { data: existing } = await sb.from('notice_response_links')
      .select('id').eq('notice_id', noticeId).eq('original_pdf_sha256', digest).is('revoked_at', null).maybeSingle();
    if (existing) return json(res, 409, { error: 'A link already exists for this exact served notice. Reuse its previously issued URL or revoke the old link first.' });
    const token = randomBytes(24).toString('base64url');
    const { error: insertError } = await sb.from('notice_response_links').insert({
      notice_id: noticeId, user_id: user.id, token_hash: hash(token),
      pdf_bucket: bucket, pdf_path: path, original_pdf_sha256: digest, original_pdf_bytes: bytes.length
    });
    if (insertError) throw insertError;
    return json(res, 201, {
      url: 'https://notices.sq1consulting.co.uk/respond/' + token,
      noticeId, pdfSha256: digest
    });
  } catch (e) {
    console.error('notice-link:', e.message);
    return json(res, 500, { error: 'Could not create response link' });
  }
}
