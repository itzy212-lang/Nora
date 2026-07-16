// api/export-minutes-pdf.js
const API2PDF_ENDPOINT = 'https://v2.api2pdf.com/chrome/pdf/html';

function getApiKey() {
  return (
    process.env.API2PDF_API_KEY ||
    process.env.API2PDF_KEY ||
    process.env.API2PDF_SECRET ||
    process.env.API2PDF_TOKEN ||
    ''
  );
}

function injectPdfCss(html = '') {
  const css = `
    <style>
      @page {
        size: A4;
        margin: 14mm 12mm 14mm 12mm;
      }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    </style>
  `;
  if (html.includes('</head>')) return html.replace('</head>', `${css}</head>`);
  return `<!DOCTYPE html><html><head>${css}</head><body>${html}</body></html>`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { html, filename } = req.body || {};
    if (!html) {
      return res.status(400).json({ error: 'Missing html' });
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(500).json({
        error: 'Missing API2PDF API key',
        details: 'Set API2PDF_API_KEY, API2PDF_KEY, API2PDF_SECRET or API2PDF_TOKEN in Vercel.',
      });
    }

    const htmlForPdf = injectPdfCss(String(html));

    const apiResponse = await fetch(API2PDF_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: htmlForPdf,
        fileName: filename || 'Weekly Site Minutes.pdf',
        inlinePdf: false,
        options: {
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: false,
          preferCSSPageSize: true,
          margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
        },
      }),
    });

    const apiPayload = await apiResponse.json().catch(() => ({}));

    if (!apiResponse.ok || !apiPayload.FileUrl) {
      return res.status(500).json({
        error: 'API2PDF failed to generate PDF',
        details: apiPayload?.Message || apiPayload?.message || JSON.stringify(apiPayload),
      });
    }

    const pdfResponse = await fetch(apiPayload.FileUrl);
    if (!pdfResponse.ok) {
      return res.status(500).json({ error: 'Could not download generated PDF' });
    }

    const arrayBuffer = await pdfResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const safeFilename = String(filename || 'Weekly Site Minutes.pdf')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).send(buffer);
  } catch (err) {
    console.error('[export-minutes-pdf] fatal error:', err);
    return res.status(500).json({ error: err.message || 'Minutes PDF export failed' });
  }
}
