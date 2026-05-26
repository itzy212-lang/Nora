import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { template_b64, merge_data = {} } = req.body || {};

    if (!template_b64) {
      return res.status(400).json({ success: false, error: 'No template_b64 provided' });
    }

    const zip = new PizZip(Buffer.from(template_b64, 'base64'));

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    });

    doc.render(merge_data || {});

    const buffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    return res.status(200).json({
      success: true,
      docx_b64: buffer.toString('base64'),
    });
  } catch (err) {
    console.error('[generate-doc]', err);

    return res.status(500).json({
      success: false,
      error: err?.message || 'Document generation failed',
    });
  }
}
