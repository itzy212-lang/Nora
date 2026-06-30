// api/extract-doc.js
// Accepts multipart file upload — handles:
// - .docx/.doc: mammoth text extraction → Claude text analysis
// - .pdf: rendered as base64 → Claude Vision
// - .jpg/.jpeg/.png: base64 → Claude Vision (drawings)
// Returns structured JSON: project details + scope items

import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// Extract text from docx using mammoth
async function extractDocxText(filePath) {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

// Convert file to base64 for Claude Vision
function fileToBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString('base64');
}

// Get media type for Claude Vision
function getMediaType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

// Claude Vision prompt for drawings
const DRAWING_PROMPT = `You are reading a construction drawing or architectural plan.

Your task:
1. Find the LEGEND or SYMBOL TABLE on this drawing (usually a box listing what each symbol means — e.g. ⊕ = double socket, ○ = single socket, etc.)
2. Use the legend to identify and COUNT every symbol on the plan
3. Also read any written notes, specifications, room names and dimensions you can see
4. Extract any electrical, plumbing, structural or other trade information visible

Return ONLY valid JSON with no markdown:
{
  "site_address": "site address if visible",
  "drawing_type": "floor plan / electrical plan / structural / etc",
  "rooms": ["list of room names visible"],
  "scope_items": [
    { "title": "item description e.g. Double socket outlet", "quantity": 24, "unit": "no.", "trade": "Electrical", "description": "any notes" }
  ],
  "notes": "any other important notes visible on the drawing",
  "legend_found": true
}

If no legend is found, still extract what you can see and set legend_found to false.`;

// Claude text prompt for written specs/tender packs
const TEXT_PROMPT = `You are extracting project information from a construction tender package or specification document.

Extract the following and return ONLY valid JSON with no markdown:
{
  "site_address": "full site address including postcode",
  "client_name": "client or employer name",
  "client_email": "client email if present",
  "client_phone": "client phone if present",
  "works_description": "brief description of the works (1-2 sentences)",
  "contract_duration_weeks": "duration in weeks as number, or null",
  "scope_items": [
    { "title": "scope item title", "description": "brief description", "trade": "trade type e.g. Groundworks, Electrical, Plumbing", "quantity": null, "unit": null }
  ]
}

Extract ALL scope items / work sections you can find. Include every line item, work section, or task described.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024 }); // 20MB
    const [, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const fileName = file.originalFilename || file.newFilename || '';
    const ext = path.extname(fileName).toLowerCase();
    const isDrawing = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    const isPdf = ext === '.pdf';
    const isDocx = ['.docx', '.doc'].includes(ext);
    const isTxt = ext === '.txt';

    let rawJson = '';

    if (isDrawing || isPdf) {
      // Vision mode — drawings/PDFs go to GPT-4o (better structured/diagrammatic
      // extraction for drawings with a legend + symbol count). This is the ONLY
      // branch routed to GPT-4o — text/docx extraction below stays on Claude.
      const base64Data = fileToBase64(file.filepath);
      const mediaType = getMediaType(fileName);
      const dataUrl = `data:${mediaType};base64,${base64Data}`;

      // GPT-4o accepts PDFs natively via the 'file' content type (extracts both
      // text and page images server-side). Plain images (jpg/png) use 'image_url'.
      // These are NOT interchangeable — sending a PDF as image_url silently
      // produces poor/garbled results rather than a clear error.
      const contentParts = isPdf
        ? [
            { type: 'text', text: DRAWING_PROMPT },
            { type: 'file', file: { filename: fileName || 'drawing.pdf', file_data: dataUrl } },
          ]
        : [
            { type: 'text', text: DRAWING_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ];

      const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: contentParts,
          }],
        }),
      });

      if (!gptRes.ok) {
        const err = await gptRes.text();
        return res.status(500).json({ error: 'GPT-4o drawing extraction failed', detail: err });
      }

      const gptData = await gptRes.json();
      rawJson = gptData?.choices?.[0]?.message?.content || '';
    } else {
      // Text mode — extract text first then send to Claude (unchanged)
      let rawText = '';
      if (isDocx) {
        rawText = await extractDocxText(file.filepath);
      } else if (isTxt) {
        rawText = fs.readFileSync(file.filepath, 'utf8');
      } else {
        return res.status(400).json({ error: 'Unsupported file type. Use PDF, JPG, PNG, DOCX or TXT.' });
      }

      const truncated = rawText.slice(0, 40000);
      const claudeMessages = [{
        role: 'user',
        content: `${TEXT_PROMPT}\n\nDOCUMENT:\n${truncated}`
      }];

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'pdfs-2024-09-25', // enable PDF support
        },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          max_tokens: 4000,
          messages: claudeMessages,
        }),
      });

      if (!claudeRes.ok) {
        const err = await claudeRes.text();
        return res.status(500).json({ error: 'Claude extraction failed', detail: err });
      }

      const claudeData = await claudeRes.json();
      rawJson = claudeData?.content?.[0]?.text || '';
    }

    const clean = rawJson.replace(/```json|```/g, '').trim();

    let extracted;
    try {
      extracted = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'Could not parse Claude response', raw: clean });
    }

    // Flag drawing-sourced items
    if (isDrawing || isPdf) {
      extracted.source = 'drawing';
      if (extracted.scope_items) {
        extracted.scope_items = extracted.scope_items.map(item => ({
          ...item,
          from_drawing: true
        }));
      }
    } else {
      extracted.source = 'document';
    }

    try { fs.unlinkSync(file.filepath); } catch {}

    return res.status(200).json({ success: true, extracted });

  } catch (err) {
    console.error('[extract-doc] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
