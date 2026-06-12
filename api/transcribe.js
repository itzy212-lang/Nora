export const config = {
  api: {
    bodyParser: false,
  },
};

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
    if (body[afterDelim] === 45 && body[afterDelim + 1] === 45) break;
    const headerStart = afterDelim + 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headers = body.slice(headerStart, headerEnd).toString('utf8');
    const contentStart = headerEnd + 4;
    const nextDelim = body.indexOf(delimiter, contentStart);
    if (nextDelim === -1) break;
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
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'OPENAI_API_KEY is not set' });
    }

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

    const audioPart = parts.find(p => {
      const cd = getHeaderValue(p.headers, 'content-disposition');
      return cd.includes('name="audio"') || cd.includes('name="file"');
    }) || parts[0];

    if (!audioPart || !audioPart.content?.length) {
      return res.status(400).json({ error: 'No audio content found', parts: parts.length });
    }

    const filename = getFilenameFromHeaders(audioPart.headers);
    const mimeType = getMimeFromHeaders(audioPart.headers);

    console.log('[transcribe] audio:', { filename, mimeType, size: audioPart.content.length });

    // Build multipart form for OpenAI directly via fetch — no SDK needed
    const boundary2 = '----OpenAIBoundary' + Date.now();
    const CRLF = '\r\n';

    const header = Buffer.from(
      `--${boundary2}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: ${mimeType}${CRLF}${CRLF}`
    );
    const modelPart = Buffer.from(
      `${CRLF}--${boundary2}${CRLF}` +
      `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
      `whisper-1${CRLF}` +
      `--${boundary2}--${CRLF}`
    );

    const formBody = Buffer.concat([header, audioPart.content, modelPart]);

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary2}`,
      },
      body: formBody,
    });

    const whisperData = await whisperRes.json().catch(() => ({}));

    if (!whisperRes.ok) {
      return res.status(500).json({
        success: false,
        error: whisperData?.error?.message || `OpenAI returned ${whisperRes.status}`,
        whisperStatus: whisperRes.status,
      });
    }

    return res.status(200).json({
      success: true,
      text: whisperData.text || '',
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

