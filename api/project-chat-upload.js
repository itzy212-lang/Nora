// api/project-chat-upload.js
// Project chat upload route. Uploads files to Supabase, extracts readable text from PDFs/DOCX/TXT/CSV,
// and stores the extracted text in project_memory so Ely can use uploaded documents in project chat.

import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs/promises';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

export const config = {
  api: {
    bodyParser: false,
  },
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function firstField(value, fallback = '') {
  if (Array.isArray(value)) return value[0] || fallback;
  return value || fallback;
}

function safeProjectKey(projectId) {
  return String(projectId || 'no-project').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function safeFileName(name = 'file') {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 160);
}

function parseForm(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: 30 * 1024 * 1024,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function extractText({ buffer, fileName, mimeType }) {
  const lower = String(fileName || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();

  try {
    if (mime.includes('pdf') || lower.endsWith('.pdf')) {
      const result = await pdf(buffer);
      const text = String(result?.text || '').trim();

      return {
        extracted_text: text,
        extraction_status: text ? 'extracted' : 'empty',
        extraction_note: text ? 'PDF text extracted.' : 'PDF parsed but no readable text was found.',
      };
    }

    if (mime.includes('wordprocessingml.document') || lower.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer });
      const text = String(result?.value || '').trim();

      return {
        extracted_text: text,
        extraction_status: text ? 'extracted' : 'empty',
        extraction_note: text ? 'DOCX text extracted.' : 'DOCX parsed but no readable text was found.',
      };
    }

    if (mime.startsWith('text/') || mime.includes('csv') || lower.endsWith('.txt') || lower.endsWith('.csv')) {
      const text = buffer.toString('utf8').trim();

      return {
        extracted_text: text,
        extraction_status: text ? 'extracted' : 'empty',
        extraction_note: text ? 'Text content extracted.' : 'Text file was empty.',
      };
    }

    return {
      extracted_text: '',
      extraction_status: 'unsupported',
      extraction_note: 'File stored. Text extraction is not supported for this file type yet.',
    };
  } catch (err) {
    return {
      extracted_text: '',
      extraction_status: 'failed',
      extraction_note: err?.message || 'Text extraction failed.',
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sb = getSupabase();

  if (!sb) {
    return res.status(500).json({ error: 'Supabase environment variables missing' });
  }

  try {
    const { fields, files } = await parseForm(req);
    const uploaded = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!uploaded) {
      return res.status(400).json({ error: 'No file received' });
    }

    const projectId = firstField(fields.project_id, '');
    const sessionId = firstField(fields.session_id, '');
    const userId = firstField(fields.user_id, 'itzy212@gmail.com');
    const projectRef = firstField(fields.project_ref, '');
    const originalName = uploaded.originalFilename || 'uploaded-file';
    const mimeType = uploaded.mimetype || 'application/octet-stream';
    const fileSize = uploaded.size || 0;

    const buffer = await fs.readFile(uploaded.filepath);

    const storagePath = [
      'project-chat',
      safeProjectKey(projectId),
      sessionId || 'session',
      `${Date.now()}_${safeFileName(originalName)}`,
    ].join('/');

    const { error: storageError } = await sb.storage
      .from('chat-uploads')
      .upload(storagePath, buffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: mimeType,
      });

    if (storageError) throw storageError;

    const extraction = await extractText({
      buffer,
      fileName: originalName,
      mimeType,
    });

    const { data: uploadRow, error: uploadError } = await sb
      .from('chat_uploads')
      .insert({
        user_id: userId,
        project_id: projectId || null,
        session_id: sessionId || null,
        chat_type: 'project_chat',
        file_name: originalName,
        mime_type: mimeType,
        file_size: fileSize,
        storage_path: storagePath,
        upload_status: 'uploaded',
        is_temporary: false,
        permanent_context: true,
        document_kind: 'project_chat_upload',
        metadata: {
          source: 'ProjectChat',
          project_id: projectId || null,
          project_ref: projectRef || null,
          extraction_status: extraction.extraction_status,
          extraction_note: extraction.extraction_note,
          extracted_text_length: extraction.extracted_text.length,
        },
      })
      .select('id, storage_path, file_name, mime_type, file_size, upload_status')
      .single();

    if (uploadError) throw uploadError;

    if (projectId) {
      const memorySummary = extraction.extracted_text
        ? `File uploaded to project chat and text extracted: ${originalName}.`
        : `File uploaded to project chat: ${originalName}. ${extraction.extraction_note}`;

      const { error: memoryError } = await sb.from('project_memory').insert({
        project_id: String(projectId),
        source_type: 'chat_upload',
        source_id: uploadRow?.id || storagePath,
        title: originalName,
        summary: memorySummary,
        content: extraction.extracted_text || '',
        entities: [],
        metadata: {
          project_id: projectId,
          session_id: sessionId,
          file_name: originalName,
          mime_type: mimeType,
          file_size: fileSize,
          storage_path: storagePath,
          upload_id: uploadRow?.id || null,
          extraction_status: extraction.extraction_status,
          extraction_note: extraction.extraction_note,
          extracted_text_length: extraction.extracted_text.length,
        },
        unresolved_items: [],
        importance_score: extraction.extracted_text ? 65 : 35,
      });

      if (memoryError) {
        console.warn('[project-chat-upload] project_memory insert failed:', memoryError.message);
      }
    }

    return res.status(200).json({
      upload_id: uploadRow?.id,
      file_name: originalName,
      mime_type: mimeType,
      file_size: fileSize,
      storage_path: storagePath,
      upload_status: 'uploaded',
      extracted_text: extraction.extracted_text,
      extraction_status: extraction.extraction_status,
      extraction_note: extraction.extraction_note,
    });
  } catch (err) {
    console.error('[project-chat-upload] error:', err);
    return res.status(500).json({
      error: err?.message || 'Upload failed',
    });
  }
}
