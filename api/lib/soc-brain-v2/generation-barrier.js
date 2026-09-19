// api/lib/soc-brain-v2/generation-barrier.js
//
// Nora SOC v2, Phase D1 — the generation barrier (Master Instructions
// §12, Pipeline & Reconciliation Spec). Confirmed in the D0 audit: no
// such barrier existed anywhere in the generation path — nothing
// checked whether a live note was still processing, had failed, or
// had raised a question still awaiting an answer before generation
// read (and, until this phase, deleted) soc_claims. This module is
// that check, and nothing else — it makes no judgment about content,
// only about whether evidence-gathering for this session is actually
// finished.
//
// Deliberately separate from generation-input.js: this answers
// "is it safe to read yet", that module answers "what does the
// evidence actually say".

/**
 * Checks whether it is safe to generate from this session's inspection
 * state right now. Blocks on:
 * - any note still actively processing (a genuine in-flight race);
 * - any note whose processing failed (drafting from a session with a
 *   known incomplete note would silently omit whatever that note was
 *   meant to record);
 * - an outstanding, unanswered pending clarification (a live,
 *   unresolved material question — drafting now would either omit it
 *   or force a decision the surveyor hasn't actually made yet).
 *
 * Returns { ok: true } when clear to proceed, or
 * { ok: false, reason, blocking_notes, pending_clarification } when not.
 */
export async function checkGenerationBarrier(supabase, sessionId) {
  const { data: notes, error } = await supabase
    .from('soc_notes')
    .select('id, sequence, raw_note, processing_status')
    .eq('session_id', sessionId)
    .order('sequence', { ascending: true });

  if (error) throw new Error(`checkGenerationBarrier: could not load soc_notes: ${error.message}`);

  const stillProcessing = (notes || []).filter(n => n.processing_status === 'processing');
  const failed = (notes || []).filter(n => n.processing_status === 'failed');

  if (stillProcessing.length) {
    return {
      ok: false,
      reason: 'notes_still_processing',
      blocking_notes: stillProcessing.map(n => ({ sequence: n.sequence, raw_note: n.raw_note })),
      pending_clarification: null,
    };
  }

  if (failed.length) {
    return {
      ok: false,
      reason: 'notes_failed_processing',
      blocking_notes: failed.map(n => ({ sequence: n.sequence, raw_note: n.raw_note })),
      pending_clarification: null,
    };
  }

  const { data: session, error: sessionErr } = await supabase
    .from('ai_sessions')
    .select('metadata')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionErr) throw new Error(`checkGenerationBarrier: could not load ai_sessions: ${sessionErr.message}`);

  const pending = session?.metadata?.pending_clarification || null;
  if (pending) {
    return {
      ok: false,
      reason: 'pending_clarification_unanswered',
      blocking_notes: [],
      pending_clarification: pending,
    };
  }

  return { ok: true };
}
