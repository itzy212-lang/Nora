import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email_id, email_external_id, thread_id, filename, project_id } = req.body || {};
    const sb = getSupabase();

    // Find the attachment(s)
    let query = sb.from('email_attachments').select('*');

    if (email_id) query = query.eq('email_id', email_id);
    else if (email_external_id) query = query.eq('email_external_id', email_external_id);
    else if (thread_id) query = query.eq('thread_id', thread_id);
    else if (project_id) {
      // Find all email ids for this project, then get attachments
      const { data: emails } = await sb.from('emails').select('id').eq('project_id', project_id);
      const emailIds = (emails || []).map(e => e.id);
      if (emailIds.length === 0) return res.status(200).json({ success: true, attachments: [] });
      query = query.in('email_id', emailIds);
    }

    if (filename) query = query.ilike('filename', `%${filename}%`);

    query = query.order('created_at', { ascending: false }).limit(10);

    const { data: attachments, error } = await query;
    if (error) throw error;
    if (!attachments?.length) return res.status(200).json({ success: true, attachments: [] });

    // For each attachment, fetch from storage and extract text
    const results = [];
    for (const att of attachments) {
      try {
        const { data: fileData, error: dlErr } = await sb.storage
          .from('email-attachments')
          .download(att.storage_path);

        if (dlErr || !fileData) {
          results.push({ id: att.id, filename: att.filename, content_type: att.content_type, extracted: false, error: 'Could not download file' });
          continue;
        }

        const arrayBuffer = await fileData.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mime = (att.content_type || '').toLowerCase();
        const name = (att.filename || '').toLowerCase();

        // Images — return as base64 for GPT-4o vision
        if (mime.includes('image') || /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(name)) {
          results.push({
            id: att.id,
            filename: att.filename,
            content_type: att.content_type,
            type: 'image',
            base64: buffer.toString('base64'),
            extracted: true,
          });
          continue;
        }

        // PDF — extract text
        if (mime.includes('pdf') || name.endsWith('.pdf')) {
          try {
            const pdfParse = (await import('pdf-parse')).default;
            const parsed = await pdfParse(buffer);
            results.push({
              id: att.id,
              filename: att.filename,
              content_type: att.content_type,
              type: 'text',
              text: parsed.text?.slice(0, 20000) || '',
              extracted: true,
            });
          } catch {
            results.push({ id: att.id, filename: att.filename, type: 'text', text: '', extracted: false, error: 'PDF parse failed' });
          }
          continue;
        }

        // Word doc
        if (mime.includes('wordprocessingml') || name.endsWith('.docx') || name.endsWith('.doc')) {
          try {
            const mammoth = await import('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            results.push({
              id: att.id,
              filename: att.filename,
              content_type: att.content_type,
              type: 'text',
              text: (result.value || '').slice(0, 20000),
              extracted: true,
            });
          } catch {
            results.push({ id: att.id, filename: att.filename, type: 'text', text: '', extracted: false, error: 'DOCX parse failed' });
          }
          continue;
        }

        // CSV / plain text
        if (mime.includes('text') || mime.includes('csv') || name.endsWith('.csv') || name.endsWith('.txt')) {
          results.push({
            id: att.id,
            filename: att.filename,
            content_type: att.content_type,
            type: 'text',
            text: buffer.toString('utf8').slice(0, 20000),
            extracted: true,
          });
          continue;
        }

        // Unsupported
        results.push({ id: att.id, filename: att.filename, content_type: att.content_type, extracted: false, error: 'Unsupported file type' });

      } catch (err) {
        results.push({ id: att.id, filename: att.filename, extracted: false, error: err.message });
      }
    }

    return res.status(200).json({ success: true, attachments: results });

  } catch (err) {
    console.error('[fetch-attachment] error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
