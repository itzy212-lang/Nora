// api/verify-extraction.js
// Takes GPT-4o's extraction result + the original file/drawing
// Claude's job: mark GPT's work — find mistakes and missing items only
// Returns a structured diff: corrections + additions

import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function fileToBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function getMediaType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

const VERIFY_PROMPT = (gptExtraction) => `You are a quality checker reviewing an AI extraction. Another AI (GPT-4o) has already extracted a list of scope items from this drawing or document. Your job is NOT to redo the extraction. Your job is to CHECK GPT's work and find only:

1. CORRECTIONS — items GPT got wrong (wrong label, wrong count, wrong description). 
2. ADDITIONS — items GPT missed entirely that are clearly visible in the document.

Do not suggest rewording for style. Do not reformat GPT's correct items. Do not flag things you are uncertain about. Only flag clear, definite mistakes or clear omissions.

GPT's extraction:
${JSON.stringify(gptExtraction, null, 2)}

Return ONLY valid JSON with no markdown in this exact format:
{
  "corrections": [
    {
      "gpt_item_index": 0,
      "gpt_version": "exactly what GPT said for this item (title + description)",
      "claude_version": "what it should be",
      "reason": "brief reason e.g. symbol clearly shows X not Y",
      "changed_field": "title or description or count",
      "gpt_text": "the specific word/phrase GPT got wrong",
      "claude_text": "the correct word/phrase"
    }
  ],
  "additions": [
    {
      "title": "item title",
      "description": "item description",
      "trade": "trade category",
      "reason": "why this was missed e.g. visible in top-right corner of plan"
    }
  ],
  "confidence": "high or medium",
  "notes": "any overall observation worth flagging (optional, keep brief)"
}

If you find no issues, return corrections: [] and additions: [].`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const form = formidable({ maxFileSize: 20 * 1024 * 1024 });

  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
    return res.status(400).json({ error: 'Failed to parse upload', detail: err.message });
  }

  try {
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const gptExtractionRaw = Array.isArray(fields.gpt_extraction)
      ? fields.gpt_extraction[0]
      : fields.gpt_extraction;

    if (!file || !gptExtractionRaw) {
      return res.status(400).json({ error: 'file and gpt_extraction are required' });
    }

    const gptExtraction = JSON.parse(gptExtractionRaw);
    const fileName = file.originalFilename || file.newFilename || 'file';
    const ext = path.extname(fileName).toLowerCase();
    const isPdf = ext === '.pdf';
    const isImage = ['.jpg', '.jpeg', '.png'].includes(ext);

    if (!isPdf && !isImage) {
      // Text-based docs — no vision needed, just pass the text
      return res.status(200).json({ 
        success: true, 
        diff: { corrections: [], additions: [], confidence: 'high', notes: 'Text document — visual verification skipped' }
      });
    }

    const base64Data = fileToBase64(file.filepath);
    const mediaType = getMediaType(fileName);
    const dataUrl = `data:${mediaType};base64,${base64Data}`;

    const contentParts = isPdf
      ? [
          { type: 'text', text: VERIFY_PROMPT(gptExtraction) },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
        ]
      : [
          { type: 'text', text: VERIFY_PROMPT(gptExtraction) },
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
        ];

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: contentParts }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return res.status(500).json({ error: 'Claude verification failed', detail: err });
    }

    const claudeData = await claudeRes.json();
    const rawJson = claudeData?.content?.[0]?.text || '';
    const clean = rawJson.replace(/```json|```/g, '').trim();

    let diff;
    try {
      diff = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'Could not parse Claude verification response', raw: clean });
    }

    try { fs.unlinkSync(file.filepath); } catch {}

    return res.status(200).json({ success: true, diff });

  } catch (err) {
    console.error('[verify-extraction] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
