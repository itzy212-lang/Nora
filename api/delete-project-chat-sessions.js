// api/delete-project-chat-sessions.js
//
// Backend delete contract for Project Chat multi-select deletion. Per
// explicit requirement: this is a real backend deletion path, not
// individual uncontrolled frontend deletes — the browser never has
// direct delete access to ai_sessions/ai_messages for this feature (see
// the RLS check performed before this was built: those tables have RLS
// enabled with a service-role-only policy, so an uncontrolled client-side
// delete would not have worked anyway, and would have been the wrong
// approach even if it had).
//
// Identity is derived exclusively from a verified Supabase auth bearer
// token — never trusted from the request body — matching the same
// pattern already established in api/ely-smart.js's verifyBearerToken().
// Ownership and surface validation, and the actual deletion, happen
// inside the delete_project_chat_sessions() Postgres function
// (supabase/migrations/20260807090000_delete_project_chat_sessions_rpc.sql),
// tested live against real ownership-violation and not-found cases
// before this endpoint was written.

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function verifyBearerToken(req, sb) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user?.id) return null;
  return user.id;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sb = getSupabase();
  if (!sb) return res.status(500).json({ error: 'Server misconfiguration' });

  const verifiedUserId = await verifyBearerToken(req, sb);
  if (!verifiedUserId) return res.status(401).json({ error: 'Unauthorized' });

  const sessionIds = Array.isArray(req.body?.session_ids) ? req.body.session_ids : [];
  if (!sessionIds.length) return res.status(400).json({ error: 'session_ids must be a non-empty array' });
  if (sessionIds.length > 100) return res.status(400).json({ error: 'Too many sessions in one request (max 100)' });

  try {
    const { data, error } = await sb.rpc('delete_project_chat_sessions', {
      p_user_id: verifiedUserId,
      p_session_ids: sessionIds,
    });
    if (error) throw new Error(error.message);

    const results = data || [];
    const deleted = results.filter((r) => r.deleted).map((r) => r.session_id);
    const failed = results.filter((r) => !r.deleted).map((r) => ({ session_id: r.session_id, reason: r.reason }));

    return res.status(200).json({ ok: true, deleted, failed, results });
  } catch (err) {
    console.error('[delete-project-chat-sessions] failed:', err.message);
    return res.status(500).json({ error: 'Deletion failed', detail: err.message });
  }
}
