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

function injectPdfCss(html = '', aoAddress = '') {
  const runningHeader = aoAddress
    ? `Schedule of Conditions - ${aoAddress}`
    : 'Schedule of Conditions';

  const safeHeader = runningHeader
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\\"')
    .replace(/\n/g, ' ');

  const css = `
    <style>
      @page {
        size: A4;
        margin: 14mm 12mm 14mm 12mm;
      }

      html,
      body {
        width: 210mm;
        margin: 0;
        padding: 0;
        background: #ffffff !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      body {
        font-family: Arial, sans-serif;
      }

      .soc-document {
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: none !important;
        background: #ffffff !important;
      }

      .soc-document::before {
        content: "${safeHeader}";
        display: block;
        font-size: 8.5pt;
        color: #666666;
        text-align: left;
        margin-bottom: 6mm;
      }

      table {
        page-break-inside: auto;
      }

      tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }

      thead {
        display: table-header-group;
      }

      tfoot {
        display: table-footer-group;
      }
    </style>
  `;

  if (html.includes('</head>')) {
    return html.replace('</head>', `${css}</head>`);
  }

  return `<!DOCTYPE html><html><head>${css}</head><body>${html}</body></html>`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { html, filename = 'Schedule of Condition.pdf', ao_address = '' } = req.body || {};

    if (!html || !String(html).trim()) {
      return res.status(400).json({ error: 'Missing html' });
    }

    const apiKey = getApiKey();

    if (!apiKey) {
      return res.status(500).json({
        error: 'Missing API2PDF API key',
        details: 'Set API2PDF_API_KEY, API2PDF_KEY, API2PDF_SECRET or API2PDF_TOKEN in Vercel.',
      });
    }

    const htmlForPdf = injectPdfCss(String(html), String(ao_address || ''));

    const apiResponse = await fetch(API2PDF_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: htmlForPdf,
        fileName: filename,
        inlinePdf: false,
        options: {
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: false,
          preferCSSPageSize: true,
          margin: {
            top: '14mm',
            right: '12mm',
            bottom: '14mm',
            left: '12mm',
          },
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
      return res.status(500).json({
        error: 'Could not download generated PDF from API2PDF',
        details: `PDF download returned ${pdfResponse.status}`,
      });
    }

    const arrayBuffer = await pdfResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const safeFilename = String(filename || 'Schedule of Condition.pdf')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Length', buffer.length);

    return res.status(200).send(buffer);
  } catch (err) {
    console.error('[export-soc-pdf] fatal error:', err);

    return res.status(500).json({
      error: err.message || 'SOC PDF export failed',
    });
  }
}
