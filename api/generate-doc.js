// api/generate-doc.js
// Vercel serverless function — fills a DOCX template with merge data
// Uses docxtemplater + pizzip

import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { template_b64, merge_data, output_format = 'docx' } = req.body;

    if (!template_b64) return res.status(400).json({ error: 'No template provided' });
    if (!merge_data)    return res.status(400).json({ error: 'No merge data provided' });

    // Decode base64 template
    const templateBuffer = Buffer.from(template_b64, 'base64');

    // Load into PizZip
    const zip = new PizZip(templateBuffer);

    // Initialise docxtemplater with {{ }} delimiters
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
    });

    // Strip {{ }} from keys so docxtemplater can match them
    const templateData = {};
    Object.keys(merge_data).forEach(key => {
      const cleanKey = key.replace(/^\{\{/, '').replace(/\}\}$/, '');
      templateData[cleanKey] = merge_data[key] ?? '';
    });

    // Render
    doc.render(templateData);

    const outputBuffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    return res.status(200).json({
      success: true,
      docx_b64: outputBuffer.toString('base64'),
    });

  } catch (err) {
    console.error('generate-doc error:', err);
    return res.status(500).json({
      error: err.message || 'Document generation failed',
      detail: err.properties?.errors ?? null,
    });
  }
}
