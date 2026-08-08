// api/summarize-attachment.js
//
// New endpoint (2026-08-08), part of the attachment save/summarize
// feature. Extracts an email attachment's text content (same extraction
// approach already proven working in fetch-attachment.js — PDF via
// pdf-parse, DOCX via mammoth, plain text/CSV directly) and turns it
// into a clean, standalone, dated fact in project_memory, using the
// exact same prompt shape and insertion pattern already proven working
// in extract-email-memory.js — deliberately consistent with existing,
// working infrastructure rather than a new format.

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function extractAttachmentText(sb, attachment) {
  const { data: fileData, error: dlErr } = await sb.storage
    .from('email-attachments')
    .download(attachment.storage_path);
  if (dlErr || !fileData) throw new Error('Could not download attachment from storage');

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const mime = (attachment.content_type || '').toLowerCase();
  const name = (attachment.filename || '').toLowerCase();

  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(buffer);
    return parsed.text?.slice(0, 20000) || '';
  }
  if (mime.includes('wordprocessingml') || name.endsWith('.docx') || name.endsWith('.doc')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return (result.value || '').slice(0, 20000);
  }
  if (mime.includes('text') || mime.includes('csv') || name.endsWith('.csv') || name.endsWith('.txt')) {
    return buffer.toString('utf-8').slice(0, 20000);
  }
  throw new Error(`Unsupported attachment type for summarisation: ${attachment.content_type || name}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { attachment_id, project_id } = req.body || {};
    if (!attachment_id || !project_id) {
      return res.status(400).json({ error: 'attachment_id and project_id are required' });
    }
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Server misconfiguration' });

    const sb = getSupabase();

    const { data: attachment, error: attErr } = await sb
      .from('email_attachments')
      .select('id, filename, content_type, storage_path, email_id')
      .eq('id', attachment_id)
      .maybeSingle();
    if (attErr || !attachment) return res.status(404).json({ error: 'Attachment not found' });

    let email = null;
    if (attachment.email_id) {
      const { data } = await sb.from('emails').select('subject, received_at, sent_at, from_address')
        .eq('id', attachment.email_id).maybeSingle();
      email = data;
    }

    const text = await extractAttachmentText(sb, attachment);
    if (!text.trim()) {
      return res.status(200).json({ ok: true, saved: 0, message: 'No extractable text found in this attachment' });
    }

    const dateStr = email?.received_at || email?.sent_at
      ? new Date(email.received_at || email.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const prompt = `You are extracting durable, standalone facts from an attached document for a party wall / construction project record.

Rules:
- Each fact must be a complete, self-contained sentence that makes sense on its own
- Every fact must state WHAT it is, WHO it involves (if named), and WHEN (use the document date given below, ${dateStr})
- Include: figures and what they represent, decisions, dates, deadlines, named parties, key terms
- Do NOT include: boilerplate, letterheads, generic formatting text, filler
- Do NOT record bare figures without context — write "Quotation of £X for [specific scope] on ${dateStr}" not just "£X"
- If there are no important facts, return an empty array

Return ONLY a JSON array of strings. No preamble, no markdown, no explanation.

Example output:
["Section 2 notice served on 14 Jun 2026 in respect of works to the flank wall.", "Quotation of £4,200 provided for enclosure works, valid until 30 Jun 2026."]

DOCUMENT: ${attachment.filename}
DOCUMENT DATE: ${dateStr}

DOCUMENT TEXT:
${text}`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.1,
      }),
    });
    const openaiData = await openaiRes.json();
    if (!openaiRes.ok) {
      return res.status(502).json({ error: 'Summarisation model call failed', detail: openaiData?.error?.message || 'unknown' });
    }
    const raw = openaiData.choices?.[0]?.message?.content?.trim() || '[]';

    let facts = [];
    try {
      facts = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (!Array.isArray(facts)) facts = [];
    } catch {
      facts = [];
    }

    if (!facts.length) {
      return res.status(200).json({ ok: true, saved: 0, message: 'No facts extracted from this document' });
    }

    const rows = facts.map((fact) => ({
      project_id,
      source_type: 'attachment',
      source_id: attachment.id,
      title: attachment.filename?.slice(0, 200) || `Attachment ${dateStr}`,
      content: fact,
      summary: fact,
      metadata: {
        filename: attachment.filename,
        content_type: attachment.content_type,
        document_date: dateStr,
        email_id: attachment.email_id || null,
        extracted_at: new Date().toISOString(),
      },
      importance_score: 0.7,
    }));

    const { data: inserted, error: insErr } = await sb.from('project_memory').insert(rows).select('id, summary');
    if (insErr) throw insErr;

    return res.status(200).json({ ok: true, saved: inserted.length, facts: inserted.map(r => r.summary) });
  } catch (err) {
    console.error('[summarize-attachment] failed:', err.message);
    return res.status(500).json({ error: 'Summarisation failed', detail: err.message });
  }
}
