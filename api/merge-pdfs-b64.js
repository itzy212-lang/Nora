// api/merge-pdfs-b64.js
// Merges multiple PDFs (provided as base64) into one using pdf-lib.
// No external API calls — pure in-process Node.js.

import { PDFDocument } from 'pdf-lib';

export const config = {
  api: { bodyParser: { sizeLimit: '30mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pdfs } = req.body;
  if (!pdfs?.length) return res.status(400).json({ error: 'No PDFs provided' });

  try {
    const merged = await PDFDocument.create();

    for (const { b64, name } of pdfs) {
      try {
        const pdfBytes = Buffer.from(b64, 'base64');
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pageIndices = doc.getPageIndices();
        const copiedPages = await merged.copyPages(doc, pageIndices);
        copiedPages.forEach(page => merged.addPage(page));
      } catch (err) {
        console.error(`[merge-pdfs-b64] Failed to load ${name}: ${err.message}`);
        // Skip corrupt pages rather than failing the whole merge
      }
    }

    const mergedBytes = await merged.save();
    const pdf_b64 = Buffer.from(mergedBytes).toString('base64');

    return res.status(200).json({ success: true, pdf_b64 });
  } catch (err) {
    console.error('[merge-pdfs-b64] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
