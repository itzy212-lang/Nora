// api/split-pdf.js
// Splits a PDF (provided as base64) into individual page PDFs using pdf-lib.
// No external API calls — pure in-process Node.js.

import { PDFDocument } from 'pdf-lib';

export const config = {
  api: { bodyParser: { sizeLimit: '30mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pdf_b64, filename = 'document.pdf' } = req.body;
  if (!pdf_b64) return res.status(400).json({ error: 'No pdf_b64 provided' });

  try {
    const pdfBytes = Buffer.from(pdf_b64, 'base64');
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageCount = srcDoc.getPageCount();

    const pages = await Promise.all(
      Array.from({ length: pageCount }, async (_, i) => {
        const singleDoc = await PDFDocument.create();
        const [copiedPage] = await singleDoc.copyPages(srcDoc, [i]);
        singleDoc.addPage(copiedPage);
        const bytes = await singleDoc.save();
        return {
          b64: Buffer.from(bytes).toString('base64'),
          page_num: i + 1,
        };
      })
    );

    console.log(`[split-pdf] Split ${filename} into ${pages.length} pages`);
    return res.status(200).json({ success: true, pages, page_count: pages.length });
  } catch (err) {
    console.error('[split-pdf] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
