// api/extract-land-registry.js
//
// Reads a HM Land Registry register of title (PDF, or a photo/scan of one) and
// returns the owners, the property address, the title number and each owner's
// address for service. Used by the "Upload Land Registry" button on the new
// project form. Nothing is saved here — the app shows the result to the user,
// who confirms it before any project field is filled in.
//
// Same upload pattern as api/extract-doc.js: small files arrive as multipart,
// large ones are uploaded to the chat-temp-uploads bucket first and referenced
// by storage_path (bypasses Vercel's ~4.5MB request limit).
//
// Provider-neutral: reads file bytes only; no mail or storage provider involved.

import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { LAND_REGISTRY_PROMPT, normaliseLandRegistry, looksLikeRegisterText } from './lib/land-registry.js';

export const config = { api: { bodyParser: false } };

const OPENAI_KEY = process.env.OPENAI_API_KEY;

const IMAGE_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

async function callLuna(content) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      max_completion_tokens: 2000,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error('Land Registry reading failed');
    err.detail = detail;
    throw err;
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let tempFilePath = null;
  try {
    let fileBuffer;
    let fileName;
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const { storage_path, file_name } = body;
      if (!storage_path) return res.status(400).json({ error: 'No storage_path provided' });

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { data, error } = await supabase.storage.from('chat-temp-uploads').download(storage_path);
      if (error || !data) return res.status(400).json({ error: 'Could not download uploaded file: ' + (error?.message || 'not found') });
      fileBuffer = Buffer.from(await data.arrayBuffer());
      fileName = file_name || storage_path.split('/').pop();
      supabase.storage.from('chat-temp-uploads').remove([storage_path]).catch(() => {});
    } else {
      const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
      const [, files] = await form.parse(req);
      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!file) return res.status(400).json({ error: 'No file uploaded' });
      tempFilePath = file.filepath;
      fileBuffer = fs.readFileSync(file.filepath);
      fileName = file.originalFilename || file.newFilename || '';
    }

    const ext = path.extname(fileName || '').toLowerCase();
    const isPdf = ext === '.pdf';
    const imageType = IMAGE_TYPES[ext];
    if (!isPdf && !imageType) {
      return res.status(400).json({ error: 'Please upload the Land Registry register as a PDF, or a JPG/PNG photo of it.' });
    }

    let raw = '';
    let mode = 'text';

    if (isPdf) {
      // A register downloaded from the Land Registry is a text PDF — read the
      // text directly (cheaper and exact). A scan has no text layer, so fall
      // back to the model reading the pages visually.
      let text = '';
      try {
        const parsed = await pdfParse(fileBuffer);
        text = parsed?.text || '';
      } catch {
        text = '';
      }
      if (text.trim().length > 200 && looksLikeRegisterText(text)) {
        raw = await callLuna(`${LAND_REGISTRY_PROMPT}\n\nDOCUMENT TEXT:\n${text.slice(0, 40000)}`);
      } else {
        mode = 'vision';
        const dataUrl = `data:application/pdf;base64,${fileBuffer.toString('base64')}`;
        raw = await callLuna([
          { type: 'text', text: LAND_REGISTRY_PROMPT },
          { type: 'file', file: { filename: fileName || 'register.pdf', file_data: dataUrl } },
        ]);
      }
    } else {
      mode = 'vision';
      const dataUrl = `data:${imageType};base64,${fileBuffer.toString('base64')}`;
      raw = await callLuna([
        { type: 'text', text: LAND_REGISTRY_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ]);
    }

    const register = normaliseLandRegistry(raw);
    if (!register) {
      return res.status(422).json({ error: 'Could not read that document. Please check it is a Land Registry register, or enter the details by hand.' });
    }
    if (!register.is_land_registry_register) {
      return res.status(422).json({ error: 'That does not look like a Land Registry register of title. Nothing was filled in.' });
    }

    return res.status(200).json({ success: true, mode, register });
  } catch (err) {
    console.error('[extract-land-registry] error:', err.message, err.detail || '');
    return res.status(500).json({ error: err.message || 'Could not read the Land Registry document.' });
  } finally {
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
    }
  }
}
