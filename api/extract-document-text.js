// api/extract-document-text.js
// Extracts plain text from an uploaded file (PDF, DOCX, or plain text).
// Built 2026-09-17, on request: lets a user upload a real Schedule of
// Condition document as their personal gold standard, instead of only
// being able to paste text in by hand.

import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { content_base64, filename } = req.body || {};
    if (!content_base64) return res.status(400).json({ error: 'Missing content_base64' });

    const buffer = Buffer.from(String(content_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    const ext = (filename || '').toLowerCase().split('.').pop();

    let text = '';
    if (ext === 'pdf') {
      const parsed = await pdfParse(buffer);
      text = parsed.text || '';
    } else if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';
    } else {
      // Plain text (.txt) or anything else — read as-is.
      text = buffer.toString('utf-8');
    }

    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    if (!text) {
      return res.status(422).json({ error: 'Could not extract any text from this file.' });
    }

    return res.status(200).json({ success: true, text, length: text.length });
  } catch (err) {
    console.error('[extract-document-text] error:', err.message);
    return res.status(500).json({ error: err.message || 'Text extraction failed' });
  }
}
