// api/docx-to-html.js
// Accepts { docx_b64: string } and returns { html: string }
// Used by NoticeReviewModal to render editable notice content

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { docx_b64 } = req.body;
  if (!docx_b64) return res.status(400).json({ error: 'No docx_b64 provided' });

  try {
    const mammoth = await import('mammoth');
    const buffer = Buffer.from(docx_b64, 'base64');

    const result = await mammoth.convertToHtml(
      { buffer },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h2:fresh",
          "p[style-name='Heading 2'] => h3:fresh",
          "b => strong",
          "i => em",
        ],
      }
    );

    return res.status(200).json({ success: true, html: result.value || '' });
  } catch (err) {
    console.error('[docx-to-html]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
