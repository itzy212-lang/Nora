// api/backfill-email-embeddings.js
// Recurring repair/recovery backfill of missing embeddings on the emails
// table. Not the primary ingestion mechanism — sync_outlook never calls
// anything embedding-related at all (confirmed by reading its source
// directly, 2026-08-06); this exists to self-heal that gap on a schedule
// until sync_outlook itself is corrected to queue embedding immediately
// after insertion (documented follow-up, not implemented in this change
// per the explicit instruction not to modify sync_outlook here).
//
// Security correction (2026-08-07): the previous version checked for a
// literal, hardcoded header value ('x-nora-manual: true') committed
// directly in this public repository — not authentication at all, since
// anyone reading the repo could call this endpoint and consume OpenAI API
// credits on any project. Replaced with a real secret, compared in
// constant time, read only from server-side environment configuration
// (never committed, never logged, never returned in any response).
//
// Required environment variable: EMBEDDING_BACKFILL_CRON_SECRET
// The same value is stored in Supabase Vault (secret name
// 'embedding_backfill_cron_secret') and read into the pg_cron job's
// request header via vault.decrypted_secrets at invocation time — the
// raw value is never written into migration SQL or the cron job's
// stored command text. See supabase/migrations/ for the schema; the
// secret itself is not a file in this repository.
//
// Call: POST /api/backfill-email-embeddings
//   Authorization: Bearer <EMBEDDING_BACKFILL_CRON_SECRET>
// Optional body: { project_id, limit }. Without project_id, sweeps
// globally (capped by limit).

export const config = { maxDuration: 120 };
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

export function constantTimeEquals(a, b) {
  // node:crypto timingSafeEqual throws on mismatched lengths, which would
  // itself leak timing information (a fast throw vs. a full comparison).
  // Pad both inputs to a fixed length first so every comparison — correct
  // secret, wrong secret, wrong length — takes the same code path.
  const FIXED_LENGTH = 128;
  const bufA = Buffer.alloc(FIXED_LENGTH);
  const bufB = Buffer.alloc(FIXED_LENGTH);
  Buffer.from(String(a || '')).copy(bufA);
  Buffer.from(String(b || '')).copy(bufB);
  const paddedEqual = timingSafeEqual(bufA, bufB);
  const lengthsEqual = String(a || '').length === String(b || '').length;
  return paddedEqual && lengthsEqual;
}

export default async function handler(req, res) {
  const configuredSecret = process.env.EMBEDDING_BACKFILL_CRON_SECRET;
  // Fails closed: if the server-side secret isn't configured at all, no
  // request can ever be authorised — never falls back to an insecure
  // default or skips the check.
  if (!configuredSecret) {
    return res.status(500).json({ error: 'Server misconfiguration: EMBEDDING_BACKFILL_CRON_SECRET is not set' });
  }

  const authHeader = req.headers['authorization'] || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const suppliedSecret = bearerMatch ? bearerMatch[1] : (req.headers['x-nora-cron-secret'] || '');

  if (!suppliedSecret || !constantTimeEquals(suppliedSecret, configuredSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const openaiKey = process.env.OPENAI_API_KEY;
  const { project_id, limit } = req.body || {};
  const capped = Math.min(Number(limit) || 50, 200);

  // Concurrency protection: atomic insert against embedding_backfill_runs,
  // which has a partial unique index allowing only one in-progress
  // (completed_at IS NULL) row at a time. A second concurrent invocation
  // hits a unique-constraint violation here and is treated as "another
  // run is active, skip" — safe under serverless concurrency, no
  // session-held advisory lock required.
  const t0 = Date.now();
  let runId = null;
  {
    const { data: claimed, error: claimErr } = await supabase
      .from('embedding_backfill_runs')
      .insert({ project_id: project_id || null })
      .select('id')
      .single();
    if (claimErr) {
      // Unique violation (Postgres code 23505) means another run is
      // already active — skip this invocation entirely, logged as such.
      await supabase.from('embedding_backfill_runs').insert({
        skipped_due_to_concurrent_run: true,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - t0,
        project_id: project_id || null,
      }).select('id').maybeSingle().catch(() => {}); // best-effort log of the skip itself; never throws
      return res.status(200).json({ ok: true, skipped: true, reason: 'another run is already active' });
    }
    runId = claimed.id;
  }

  let done = 0, failed = 0, rowsSelected = 0, errorSummary = null;
  try {
    let query = supabase
      .from('emails')
      .select('id, subject, body, body_preview')
      .is('embedding', null)
      .limit(capped);
    if (project_id) query = query.eq('project_id', project_id);

    const { data: rows, error: fetchErr } = await query;
    if (fetchErr) throw new Error(fetchErr.message);
    rowsSelected = rows?.length || 0;

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
        // Retry behaviour: a row is only ever marked complete by actually
        // writing its embedding. A failure here leaves the row's
        // embedding column NULL, so it remains eligible for the next
        // run automatically — no separate "attempted" state is written.
        if (embedding) {
          await supabase.from('emails').update({ embedding }).eq('id', row.id);
          done++;
        } else {
          failed++;
        }
      } catch (rowErr) {
        // One failed row must never terminate the batch — caught here,
        // loop continues to the next row.
        failed++;
      }
    }
  } catch (batchErr) {
    errorSummary = String(batchErr.message || batchErr).slice(0, 500);
  } finally {
    await supabase.from('embedding_backfill_runs').update({
      completed_at: new Date().toISOString(),
      rows_selected: rowsSelected,
      rows_embedded: done,
      rows_failed: failed,
      error_summary: errorSummary,
      duration_ms: Date.now() - t0,
    }).eq('id', runId);
  }

  return res.status(200).json({ ok: true, done, failed, total: rowsSelected, project_id: project_id || 'all' });
}
