import { getServerClient } from './_supabaseAdmin.js';

const API2PDF_KEY = process.env.API2PDF_API_KEY;

async function convertDocxToPdf(docxB64, fileName) {
  const supabase = getServerClient();
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tempPath = `temp/pdf-merge/${Date.now()}-${safeFileName}`;

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

  // Cleanup temp file
  await supabase.storage.from('documents').remove([tempPath]).catch(() => {});

  if (!pdfRes.ok || !pdfJson?.FileUrl) throw new Error(`PDF conversion failed: ${JSON.stringify(pdfJson)}`);

  return pdfJson.FileUrl; // Return URL, not buffer — API2PDF merge accepts URLs
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
  // documents: [{ key, fileName, docx_b64 }] already in correct order

  if (!documents?.length) return res.status(400).json({ error: 'No documents provided' });

  try {
    // Convert all docx to PDF and get URLs
    const pdfUrls = [];
    for (const doc of documents) {
      const url = await convertDocxToPdf(doc.docx_b64, doc.fileName);
      pdfUrls.push(url);
    }

    if (pdfUrls.length === 1) {
      // Only one doc — just download the PDF directly
      const downloaded = await fetch(pdfUrls[0]);
      const buffer = await downloaded.arrayBuffer();
      return res.status(200).json({ success: true, pdf_b64: Buffer.from(buffer).toString('base64') });
    }

    // Merge all PDFs
    const mergedB64 = await mergePdfs(pdfUrls, outputFileName || 'Notice_Pack.pdf');
    return res.status(200).json({ success: true, pdf_b64: mergedB64 });

  } catch (err) {
    console.error('[merge-notice-pdfs]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
