export const config = {
  api: {
    bodyParser: false,
  },
};

import { Readable } from 'stream';
import OpenAI from 'openai';
import { toFile } from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBoundary(contentType = '') {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
  return match ? (match[1] || match[2]) : null;
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;

  while (start < body.length) {
    const delimIdx = body.indexOf(delimiter, start);
    if (delimIdx === -1) break;

    const afterDelim = delimIdx + delimiter.length;

    // Check for final boundary (--)
    if (body[afterDelim] === 45 && body[afterDelim + 1] === 45) break;

    // Skip CRLF after boundary
    const headerStart = afterDelim + 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;

    const headers = body.slice(headerStart, headerEnd).toString('utf8');
    const contentStart = headerEnd + 4;

    const nextDelim = body.indexOf(delimiter, contentStart);
    if (nextDelim === -1) break;

    // Content ends 2 bytes before the next delimiter (CRLF)
    const content = body.slice(contentStart, nextDelim - 2);

    parts.push({ headers, content });
    start = nextDelim;
  }

  return parts;
}

function getHeaderValue(headers, name) {
  const regex = new RegExp(`${name}:\\s*([^\\r\\n]+)`, 'i');
  const match = headers.match(regex);
  return match ? match[1].trim() : '';
}

function getFilenameFromHeaders(headers) {
  const cd = getHeaderValue(headers, 'content-disposition');
  const match = cd.match(/filename="?([^";]+)"?/i);
  return match ? match[1].trim() : 'audio.webm';
}

function getMimeFromHeaders(headers) {
  return getHeaderValue(headers, 'content-type') || 'audio/webm';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const contentType = req.headers['content-type'] || '';
    const boundary = parseBoundary(contentType);

    if (!boundary) {
      return res.status(400).json({ error: 'No multipart boundary found', contentType });
    }

    const rawBody = await getRawBody(req);
    const parts = parseMultipart(rawBody, boundary);

    if (!parts.length) {
      return res.status(400).json({ error: 'No parts parsed from multipart body', bodyLength: rawBody.length });
    }

    // Find the audio part
    const audioPart = parts.find(p => {
      const cd = getHeaderValue(p.headers, 'content-disposition');
      return cd.includes('name="audio"') || cd.includes('name="file"');
    }) || parts[0];

    if (!audioPart || !audioPart.content?.length) {
      return res.status(400).json({ error: 'No audio content found in upload', parts: parts.length });
    }

    const filename = getFilenameFromHeaders(audioPart.headers);
    const mimeType = getMimeFromHeaders(audioPart.headers);

    console.log('[transcribe] audio part:', { filename, mimeType, size: audioPart.content.length });

    const audioFile = await toFile(
      Readable.from(audioPart.content),
      filename,
      { type: mimeType }
    );

    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
    });

    return res.status(200).json({
      success: true,
      text: transcription.text || '',
    });

  } catch (error) {
    console.error('TRANSCRIBE ERROR:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Transcription failed',
      stack: error.stack?.split('\n').slice(0, 3).join(' | '),
    });
  }
}
