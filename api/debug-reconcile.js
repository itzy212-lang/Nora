// api/debug-reconcile.js
//
// TEMPORARY, diagnostic-only endpoint for Phase D2 acceptance
// verification (2026-09-19) — invokes reconcile() against a session
// using the live production model and returns its output as JSON.
// Strictly read-only: reconcile() itself performs only SELECT queries
// (see generation-input.js, generation-barrier.js) — nothing here
// writes to any table.
//
// GET only, query-param secret (not a header, since this endpoint
// exists specifically to be called by a tool that can only issue GET
// requests with no custom headers) — 404, not 403, on any mismatch so
// the endpoint's existence isn't confirmed to an unauthorised caller.
//
// Flagged for removal once D2 acceptance is confirmed — this is not
// intended as a permanent feature.

import { createClient } from '@supabase/supabase-js';
import { reconcile } from './lib/soc-brain-v2/reconciliation.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DEBUG_KEY = 'd2acc-7f3k9-reconcile-verify-2026';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(404).end();
  if (req.query?.key !== DEBUG_KEY) return res.status(404).end();

  const sessionId = req.query?.session_id;
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });

  try {
    const result = await reconcile(supabase, {
      sessionId,
      apiKey: process.env.OPENAI_API_KEY,
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
