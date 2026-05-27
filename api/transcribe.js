export const config = {
  api: {
    bodyParser: false,
  },
};

import formidable from 'formidable';
import fs from 'fs';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  try {
    const { files } = await parseForm(req);

    const audio =
      files.audio ||
      files.file ||
      Object.values(files)[0];

    if (!audio) {
      return res.status(400).json({
        error: 'No audio uploaded',
      });
    }

    const filePath = audio.filepath || audio.path;

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'gpt-4o-mini-transcribe',
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
    });
  }
}
