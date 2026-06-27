// api/embed.js
// Generates and stores embeddings for project content (emails, chat messages, documents)
// Called after new content is saved — non-blocking, failure is non-fatal

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMS = 1536;
const BATCH_SIZE = 20;

function getSb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function generateEmbedding(text) {
  if (!OPENAI_KEY) throw new Error('Missing OPENAI_API_KEY');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000), dimensions: EMBED_DIMS }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings error: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

function emailToText(email) {
  const direction = email.direction === 'outgoing' ? 'SENT' : 'RECEIVED';
  const from = email.sender_name || email.sender_email || '';
  const to = email.to_email || '';
  const body = (email.body || email.body_preview || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return `${direction} email. Subject: ${email.subject || ''}. From: ${from}. To: ${to}. ${body}`.slice(0, 8000);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sb = getSb();
  if (!sb) return res.status(500).json({ error: 'Supabase not configured' });
  if (!OPENAI_KEY) return res.status(500).json({ error: 'OpenAI key not configured' });

  const { action, project_id, record_id, table } = req.body || {};

  try {
    // ── Single record embedding ────────────────────────────────────────────
    if (action === 'embed_record' && record_id && table) {
      let text = '';
      let record = null;

      if (table === 'emails') {
        const { data } = await sb.from('emails').select('*').eq('id', record_id).single();
        record = data;
        text = emailToText(record);
      } else if (table === 'ai_messages') {
        const { data } = await sb.from('ai_messages').select('*').eq('id', record_id).single();
        record = data;
        text = record.content || '';
      } else if (table === 'project_memory') {
        const { data } = await sb.from('project_memory').select('*').eq('id', record_id).single();
        record = data;
        text = `${record.title || ''} ${record.summary || ''} ${record.content || ''}`;
      }

      if (!text.trim()) return res.status(200).json({ skipped: true, reason: 'no text' });

      const embedding = await generateEmbedding(text);
      await sb.from(table).update({ embedding }).eq('id', record_id);

      return res.status(200).json({ success: true, table, record_id });
    }

    // ── Batch backfill ─────────────────────────────────────────────────────
    if (action === 'backfill') {
      const results = { emails: 0, messages: 0, memory: 0, errors: 0 };

      // Emails without embeddings
      const emailQuery = sb.from('emails')
        .select('id, subject, direction, sender_name, sender_email, to_email, body, body_preview, received_at')
        .is('embedding', null)
        .not('project_id', 'is', null);
      if (project_id) emailQuery.eq('project_id', project_id);
      const { data: emails } = await emailQuery.limit(BATCH_SIZE);

      for (const email of emails || []) {
        try {
          const text = emailToText(email);
          if (!text.trim()) continue;
          const embedding = await generateEmbedding(text);
          await sb.from('emails').update({ embedding }).eq('id', email.id);
          results.emails++;
        } catch { results.errors++; }
      }

      // Chat messages without embeddings
      const msgQuery = sb.from('ai_messages')
        .select('id, content')
        .is('embedding', null)
        .eq('role', 'user')
        .not('project_id', 'is', null);
      if (project_id) msgQuery.eq('project_id', project_id);
      const { data: messages } = await msgQuery.limit(BATCH_SIZE);

      for (const msg of messages || []) {
        try {
          if (!msg.content?.trim()) continue;
          const embedding = await generateEmbedding(msg.content);
          await sb.from('ai_messages').update({ embedding }).eq('id', msg.id);
          results.messages++;
        } catch { results.errors++; }
      }

      // Project memory without embeddings
      const memQuery = sb.from('project_memory')
        .select('id, title, summary, content')
        .is('embedding', null)
        .not('project_id', 'is', null);
      if (project_id) memQuery.eq('project_id', project_id);
      const { data: memory } = await memQuery.limit(BATCH_SIZE);

      for (const mem of memory || []) {
        try {
          const text = `${mem.title || ''} ${mem.summary || ''} ${mem.content || ''}`.trim();
          if (!text) continue;
          const embedding = await generateEmbedding(text);
          await sb.from('project_memory').update({ embedding }).eq('id', mem.id);
          results.memory++;
        } catch { results.errors++; }
      }

      return res.status(200).json({ success: true, results });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('[embed] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
