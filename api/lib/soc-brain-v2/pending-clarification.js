// api/lib/soc-brain-v2/pending-clarification.js
//
// Nora SOC v2, Phase C — pending clarification state (Inspection State
// Contract §20). Stored in ai_sessions.metadata (an existing jsonb
// column) rather than a new table, per Master Instructions §14 ("do not
// add database complexity without need") — this is small, single-valued,
// per-session state with no need for its own relational shape.

export async function getPendingClarification(supabase, sessionId) {
  const { data } = await supabase
    .from('ai_sessions')
    .select('metadata')
    .eq('id', sessionId)
    .maybeSingle();
  return data?.metadata?.pending_clarification || null;
}

export async function setPendingClarification(supabase, sessionId, clarification) {
  const { data } = await supabase.from('ai_sessions').select('metadata').eq('id', sessionId).maybeSingle();
  const metadata = { ...(data?.metadata || {}), pending_clarification: clarification };
  await supabase.from('ai_sessions').update({ metadata }).eq('id', sessionId);
}

export async function clearPendingClarification(supabase, sessionId) {
  await setPendingClarification(supabase, sessionId, null);
}
