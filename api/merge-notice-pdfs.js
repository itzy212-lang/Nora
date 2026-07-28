import { createClient } from '@supabase/supabase-js';

const API2PDF_KEY = process.env.API2PDF_API_KEY;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

function getServerClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function convertDocxToPdf(docxB64, fileName) {
  const supabase = getServerClient();
  if (!supabase) throw new Error('Supabase admin client unavailable');

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tempPath = `temp/pdf-merge/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeFileName}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(tempPath, Buffer.from(docxB64, 'base64'), {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: signedData, error: signedError } = await supabase.storage
    .from('documents')
    .createSignedUrl(tempPath, 300);

  if (signedError || !signedData?.signedUrl) throw new Error('Signed URL failed');

  const pdfRes = await fetch('https://v2.api2pdf.com/libreoffice/any-to-pdf', {
    method: 'POST',
    headers: { Authorization: API2PDF_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: signedData.signedUrl, fileName: safeFileName.replace(/\.docx$/i, '.pdf') }),
  });

  const pdfJson = await pdfRes.json().catch(() => ({}));

  // Cleanup temp file (non-blocking)
  supabase.storage.from('documents').remove([tempPath]).catch(() => {});

  if (!pdfRes.ok || !pdfJson?.FileUrl) throw new Error(`PDF conversion failed: ${JSON.stringify(pdfJson)}`);

  return pdfJson.FileUrl;
}

async function mergePdfs(pdfUrls, fileName) {
  const mergeRes = await fetch('https://v2.api2pdf.com/merge', {
    method: 'POST',
    headers: { Authorization: API2PDF_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: pdfUrls, fileName }),
  });

  const mergeJson = await mergeRes.json().catch(() => ({}));
  if (!mergeRes.ok || !mergeJson?.FileUrl) throw new Error(`PDF merge failed: ${JSON.stringify(mergeJson)}`);

  const downloaded = await fetch(mergeJson.FileUrl);
  if (!downloaded.ok) throw new Error('PDF download failed');

  const buffer = await downloaded.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!API2PDF_KEY) return res.status(500).json({ error: 'API2PDF_API_KEY not configured' });

  const { documents, outputFileName } = req.body;
  if (!documents?.length) return res.status(400).json({ error: 'No documents provided' });

  console.log(`[merge-notice-pdfs] Converting ${documents.length} documents in parallel`);

  try {
    const pdfUrls = await Promise.all(
      documents.map(doc => convertDocxToPdf(doc.docx_b64, doc.fileName))
    );

    console.log(`[merge-notice-pdfs] All ${pdfUrls.length} PDFs converted`);

    if (pdfUrls.length === 1) {
      const downloaded = await fetch(pdfUrls[0]);
      const buffer = await downloaded.arrayBuffer();
      return res.status(200).json({ success: true, pdf_b64: Buffer.from(buffer).toString('base64') });
    }

    const mergedB64 = await mergePdfs(pdfUrls, outputFileName || 'Notice_Pack.pdf');
    console.log('[merge-notice-pdfs] Merge complete');
    return res.status(200).json({ success: true, pdf_b64: mergedB64 });

  } catch (err) {
    console.error('[merge-notice-pdfs] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
