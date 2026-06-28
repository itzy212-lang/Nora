// api/extract-doc.js
// Accepts a multipart file upload, extracts text (mammoth for docx),
// then uses Claude to extract project details and scope items

import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function extractText(filePath, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.docx' || ext === '.doc') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } else if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf8');
  } else if (ext === '.pdf') {
    // Basic PDF text extraction via buffer read
    const buf = fs.readFileSync(filePath);
    const text = buf.toString('latin1');
    // Extract readable text between stream markers
    const matches = text.match(/BT[\s\S]*?ET/g) || [];
    return matches.join(' ').replace(/[^\x20-\x7E\n]/g, ' ').slice(0, 50000);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    const [, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // Extract text from the document
    const rawText = await extractText(file.filepath, file.originalFilename || file.newFilename);
    if (!rawText?.trim()) return res.status(400).json({ error: 'Could not extract text from document' });

    const truncated = rawText.slice(0, 40000);

    // Ask Claude to extract structured data
    const prompt = `You are extracting project information from a construction tender package or project document.

Extract the following from the document and return ONLY valid JSON with no markdown, no explanation:
{
  "site_address": "full site address including postcode",
  "client_name": "client or employer name",
  "client_email": "client email if present",
  "client_phone": "client phone if present",
  "works_description": "brief description of the works (1-2 sentences)",
  "contract_value": "estimated contract value as number only (no £ sign), or null if not found",
  "contract_duration_weeks": "duration in weeks as number, or null",
  "scope_items": [
    { "title": "scope item title", "description": "brief description", "trade": "trade type e.g. Groundworks, Electrical, Plumbing" }
  ]
}

Extract ALL scope items / work sections you can find. Include every line item, work section, or task described.

DOCUMENT:
${truncated}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return res.status(500).json({ error: 'Claude extraction failed', detail: err });
    }

    const claudeData = await claudeRes.json();
    const rawJson = claudeData?.content?.[0]?.text || '';
    const clean = rawJson.replace(/```json|```/g, '').trim();
    const extracted = JSON.parse(clean);

    // Clean up temp file
    try { fs.unlinkSync(file.filepath); } catch {}

    return res.status(200).json({ success: true, extracted });

  } catch (err) {
    console.error('[extract-doc] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
