// api/merge-pdfs-b64.js
// Accepts { pdfs: [{ b64, name }] } — array of PDFs in order
// Returns { pdf_b64 } — merged result
// Used by NoticeReviewModal to merge attached drawings into the notice pack

import { createClient } from '@supabase/supabase-js';

const API2PDF_KEY = process.env.API2PDF_API_KEY;

export const config = {
  api: { bodyParser: { sizeLimit: '30mb' } },
};

function getServerClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function uploadAndSign(supabase, b64, name) {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `temp/pdf-merge/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;

  const { error } = await supabase.storage
    .from('documents')
    .upload(path, Buffer.from(b64, 'base64'), { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data, error: signErr } = await supabase.storage
    .from('documents')
    .createSignedUrl(path, 300);
  if (signErr || !data?.signedUrl) throw new Error('Signed URL failed');

  return { path, signedUrl: data.signedUrl };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!API2PDF_KEY) return res.status(500).json({ error: 'API2PDF not configured' });

  const { pdfs } = req.body;
  if (!pdfs?.length) return res.status(400).json({ error: 'No PDFs provided' });

  const supabase = getServerClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase unavailable' });

  const tempPaths = [];

  try {
    // Upload all PDFs and get signed URLs
    const uploads = await Promise.all(
      pdfs.map(p => uploadAndSign(supabase, p.b64, p.name || 'document.pdf'))
    );
    tempPaths.push(...uploads.map(u => u.path));

    if (uploads.length === 1) {
      // Only one PDF — return as-is
      return res.status(200).json({ success: true, pdf_b64: pdfs[0].b64 });
    }

    // Merge via API2PDF
    const mergeRes = await fetch('https://v2.api2pdf.com/merge', {
      method: 'POST',
      headers: { Authorization: API2PDF_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: uploads.map(u => u.signedUrl), fileName: 'merged.pdf' }),
    });

    const mergeJson = await mergeRes.json().catch(() => ({}));
    const mergeUrl = mergeJson?.FileUrl || mergeJson?.pdf;
    if (!mergeRes.ok || !mergeUrl) throw new Error(`Merge failed: ${JSON.stringify(mergeJson)}`);

    const downloaded = await fetch(mergeUrl);
    if (!downloaded.ok) throw new Error('Download failed');

    const buffer = await downloaded.arrayBuffer();
    return res.status(200).json({ success: true, pdf_b64: Buffer.from(buffer).toString('base64') });

  } catch (err) {
    console.error('[merge-pdfs-b64]', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    if (tempPaths.length) supabase.storage.from('documents').remove(tempPaths).catch(() => {});
  }
}
