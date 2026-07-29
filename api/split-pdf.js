// api/split-pdf.js
// Accepts { pdf_b64: string } — a PDF
// Returns { pages: [{ b64, page_num }] } — one entry per page
// Used by NoticeReviewModal to show individual pages from attached drawings

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!API2PDF_KEY) return res.status(500).json({ error: 'API2PDF not configured' });

  const { pdf_b64, filename = 'document.pdf' } = req.body;
  if (!pdf_b64) return res.status(400).json({ error: 'No pdf_b64 provided' });

  const supabase = getServerClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase unavailable' });

  const tempPaths = [];

  try {
    // Upload the PDF to temp storage
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploadPath = `temp/pdf-split/${Date.now()}-${safeName}`;
    tempPaths.push(uploadPath);

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(uploadPath, Buffer.from(pdf_b64, 'base64'), {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: signedData, error: signedError } = await supabase.storage
      .from('documents')
      .createSignedUrl(uploadPath, 300);
    if (signedError || !signedData?.signedUrl) throw new Error('Signed URL failed');

    // Use API2PDF to split into individual pages
    const splitRes = await fetch('https://v2.api2pdf.com/pdf/split', {
      method: 'POST',
      headers: { Authorization: API2PDF_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: signedData.signedUrl,
        outputType: 'separate', // one PDF per page
      }),
    });

    const splitJson = await splitRes.json().catch(() => ({}));
    console.log('[split-pdf] API2PDF response:', JSON.stringify(splitJson).slice(0, 200));

    // API2PDF split returns FileUrls array (one per page)
    const pageUrls = splitJson?.FileUrls || splitJson?.fileUrls || splitJson?.pdfs || [];

    if (!splitRes.ok || !pageUrls.length) {
      // Fallback: if split not supported, return the whole PDF as one page
      console.warn('[split-pdf] Split not available, returning as single page');
      return res.status(200).json({
        success: true,
        pages: [{ b64: pdf_b64, page_num: 1 }],
        page_count: 1,
      });
    }

    // Download each page
    const pages = await Promise.all(
      pageUrls.map(async (url, i) => {
        const dl = await fetch(url);
        if (!dl.ok) throw new Error(`Page ${i + 1} download failed`);
        const buf = await dl.arrayBuffer();
        return { b64: Buffer.from(buf).toString('base64'), page_num: i + 1 };
      })
    );

    console.log(`[split-pdf] Split into ${pages.length} pages`);
    return res.status(200).json({ success: true, pages, page_count: pages.length });

  } catch (err) {
    console.error('[split-pdf] Error:', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    if (tempPaths.length) supabase.storage.from('documents').remove(tempPaths).catch(() => {});
  }
}
