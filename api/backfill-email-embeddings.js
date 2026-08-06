// api/backfill-email-embeddings.js
// One-time backfill of missing embeddings on the emails table.
// Mirrors the existing pattern in api/backfill-embeddings.js (which only
// covers project_memory) — this covers emails specifically, since that's
// the gap found on 2026-08-06: recent emails were not reliably getting
// embedded by api/embed.js's non-blocking, best-effort call after
// ingestion, leaving them invisible to search_project_content's semantic
// search regardless of how well the retrieval code itself is wired.
//
// Call once manually: POST /api/backfill-email-embeddings with
// header x-nora-manual: true. Optional body: { project_id, limit }.
// Without project_id, sweeps globally (capped by limit) — use with care.

export const config = { maxDuration: 120 };
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.headers['x-nora-manual'] !== 'true') return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const openaiKey = process.env.OPENAI_API_KEY;
  const { project_id, limit } = req.body || {};
  const capped = Math.min(Number(limit) || 50, 200);

  let query = supabase
    .from('emails')
    .select('id, subject, body, body_preview')
    .is('embedding', null)
    .limit(capped);
  if (project_id) query = query.eq('project_id', project_id);

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  let done = 0, failed = 0;
  for (const row of rows || []) {
    try {
      const text = [row.subject, row.body_preview || (row.body || '').slice(0, 4000)]
        .filter(Boolean).join('\n\n');
      if (!text.trim()) { failed++; continue; }
      const embRes = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000), dimensions: 1536 }),
      });
      const embData = await embRes.json();
      const embedding = embData.data?.[0]?.embedding;
      if (embedding) {
        await supabase.from('emails').update({ embedding }).eq('id', row.id);
        done++;
      } else {
        failed++;
      }
    } catch (e) { failed++; }
  }

  return res.status(200).json({ ok: true, done, failed, total: rows?.length || 0, project_id: project_id || 'all' });
}
