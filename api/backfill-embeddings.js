// api/backfill-embeddings.js
// One-time backfill of missing embeddings in project_memory
// Call once manually: POST /api/backfill-embeddings with x-nora-manual: true

export const config = { maxDuration: 120 };
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.headers['x-nora-manual'] !== 'true') return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const openaiKey = process.env.OPENAI_API_KEY;

  const { data: rows } = await supabase
    .from('project_memory')
    .select('id, summary')
    .is('embedding', null)
    .limit(50);

  let done = 0, failed = 0;
  for (const row of rows || []) {
    try {
      const embRes = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: row.summary }),
      });
      const embData = await embRes.json();
      const embedding = embData.data?.[0]?.embedding;
      if (embedding) {
        await supabase.from('project_memory').update({ embedding }).eq('id', row.id);
        done++;
      }
    } catch (e) { failed++; }
  }

  return res.status(200).json({ ok: true, done, failed, total: rows?.length || 0 });
}
