// api/clause-library.js
// Added 2026-09-10, on request: a small library of the user's own
// example clauses, semantically searched against a new clause
// request so a generated clause can be genuinely inspired by
// clauses they've actually used before, not just the general
// drafting instruction alone. Reuses the same embedding model and
// pattern already proven in api/embed.js.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMS = 1536;

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
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000), dimensions: EMBED_DIMS }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings error: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sb = getSb();
  if (!sb) return res.status(500).json({ error: 'Supabase not configured' });
  if (!OPENAI_KEY) return res.status(500).json({ error: 'OpenAI key not configured' });

  const { action } = req.body || {};

  try {
    // ── Save a new example clause ──────────────────────────────────
    if (action === 'save') {
      const { text, label } = req.body || {};
      const clean = String(text || '').trim();
      if (!clean) return res.status(400).json({ error: 'No clause text provided' });

      const embedding = await generateEmbedding(clean);
      const { data, error } = await sb
        .from('clause_library')
        .insert([{ text: clean, label: label || null, embedding }])
        .select('id, text, label, created_at')
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ saved: data });
    }

    // ── Search for the most relevant saved examples ────────────────
    if (action === 'search') {
      const { query, matchCount } = req.body || {};
      const clean = String(query || '').trim();
      if (!clean) return res.status(200).json({ matches: [] });

      const embedding = await generateEmbedding(clean);
      const { data, error } = await sb.rpc('match_clause_library', {
        query_embedding: embedding,
        match_count: matchCount || 3,
      });

      if (error) return res.status(500).json({ error: error.message });
      // Only surface genuinely relevant matches — an unrelated saved
      // clause is worse than no example at all for this purpose.
      const relevant = (data || []).filter(m => m.similarity > 0.55);
      return res.status(200).json({ matches: relevant });
    }

    // ── List all saved examples (for the library management UI) ────
    if (action === 'list') {
      const { data, error } = await sb
        .from('clause_library')
        .select('id, text, label, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ items: data || [] });
    }

    // ── Delete a saved example ───────────────────────────────────────
    if (action === 'delete') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'No id provided' });
      const { error } = await sb.from('clause_library').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ deleted: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Clause library request failed' });
  }
}
