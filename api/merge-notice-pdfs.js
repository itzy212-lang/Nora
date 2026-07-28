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

// Convert a single docx (base64) to PDF (base64) via API2PDF
async function convertDocxToPdf(docxB64, fileName) {
  const supabase = getServerClient();
  if (!supabase) throw new Error('Supabase admin client unavailable');

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tempPath = `temp/pdf-merge/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeFileName}`;

  // Upload docx to temp storage
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(tempPath, Buffer.from(docxB64, 'base64'), {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // Get signed URL
  const { data: signedData, error: signedError } = await supabase.storage
    .from('documents')
    .createSignedUrl(tempPath, 300);
  if (signedError || !signedData?.signedUrl) throw new Error('Signed URL failed');

  // Convert via API2PDF
  const pdfRes = await fetch('https://v2.api2pdf.com/libreoffice/any-to-pdf', {
    method: 'POST',
    headers: { Authorization: API2PDF_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: signedData.signedUrl,
      fileName: safeFileName.replace(/\.docx$/i, '.pdf'),
    }),
  });

  const pdfJson = await pdfRes.json().catch(() => ({}));
  supabase.storage.from('documents').remove([tempPath]).catch(() => {});

  const pdfUrl = pdfJson?.FileUrl || pdfJson?.pdf;
  if (!pdfRes.ok || !pdfUrl) {
    throw new Error(`PDF conversion failed: ${JSON.stringify(pdfJson)}`);
  }

  // Download the PDF immediately while the URL is fresh
  const pdfDownload = await fetch(pdfUrl);
  if (!pdfDownload.ok) throw new Error(`PDF download failed: ${pdfDownload.status}`);

  const buffer = await pdfDownload.arrayBuffer();
  return Buffer.from(buffer);
}

// Upload a PDF buffer to temp storage and get a signed URL for API2PDF merge
async function uploadPdfForMerge(supabase, pdfBuffer, index) {
  const tempPath = `temp/pdf-merge/merge-${Date.now()}-${index}.pdf`;

  const { error } = await supabase.storage
    .from('documents')
    .upload(tempPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(`PDF re-upload failed: ${error.message}`);

  const { data, error: signedError } = await supabase.storage
    .from('documents')
    .createSignedUrl(tempPath, 300);
  if (signedError || !data?.signedUrl) throw new Error('PDF signed URL failed');

  return { url: tempPath, signedUrl: data.signedUrl };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!API2PDF_KEY) return res.status(500).json({ error: 'API2PDF_API_KEY not configured' });

  const { documents, outputFileName } = req.body;
  if (!documents?.length) return res.status(400).json({ error: 'No documents provided' });

  console.log(`[merge-notice-pdfs] Converting ${documents.length} documents`);

  const supabase = getServerClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase unavailable' });

  const tempPaths = [];

  try {
    // Step 1: Convert all docx to PDF buffers in parallel
    const pdfBuffers = await Promise.all(
      documents.map(doc => convertDocxToPdf(doc.docx_b64, doc.fileName))
    );
    console.log(`[merge-notice-pdfs] ${pdfBuffers.length} PDFs converted`);

    // If only one doc, return it directly
    if (pdfBuffers.length === 1) {
      return res.status(200).json({
        success: true,
        pdf_b64: pdfBuffers[0].toString('base64'),
      });
    }

    // Step 2: Upload each PDF back to Supabase to get fresh signed URLs for merge
    const uploadResults = await Promise.all(
      pdfBuffers.map((buf, i) => uploadPdfForMerge(supabase, buf, i))
    );
    tempPaths.push(...uploadResults.map(r => r.url));

    const signedUrls = uploadResults.map(r => r.signedUrl);
    console.log(`[merge-notice-pdfs] Merging ${signedUrls.length} PDFs`);

    // Step 3: Merge via API2PDF
    const mergeRes = await fetch('https://v2.api2pdf.com/merge', {
      method: 'POST',
      headers: { Authorization: API2PDF_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: signedUrls,
        fileName: outputFileName || 'Notice_Pack.pdf',
      }),
    });

    const mergeJson = await mergeRes.json().catch(() => ({}));
    console.log('[merge-notice-pdfs] Merge response:', JSON.stringify(mergeJson));

    if (!mergeRes.ok || !mergeJson?.FileUrl) {
      throw new Error(`PDF merge failed: ${JSON.stringify(mergeJson)}`);
    }

    // Step 4: Download merged PDF
    const merged = await fetch(mergeJson.FileUrl);
    if (!merged.ok) throw new Error('Merged PDF download failed');

    const mergedBuffer = await merged.arrayBuffer();
    return res.status(200).json({
      success: true,
      pdf_b64: Buffer.from(mergedBuffer).toString('base64'),
    });

  } catch (err) {
    console.error('[merge-notice-pdfs] Error:', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    // Clean up all temp files
    if (tempPaths.length) {
      supabase.storage.from('documents').remove(tempPaths).catch(() => {});
    }
  }
}
