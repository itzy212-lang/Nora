// api/process-soc-note.js
//
// Nora SOC v2, Phase C — the live semantic processor.
//
// Rewritten to implement the Live Processing stage defined in the SOC v2
// specifications: Universal SOC Brain + Live Processing Contract +
// persistent Inspection State (soc_sections, soc_claims) resolve each
// dictated note in context, rather than the previous ad-hoc keyword-hint
// + narrow single-note prompt. Per explicit instruction, this does not
// replace semantic interpretation with regex/keyword rules — room
// transitions, returns, corrections, additions and clarification
// decisions all remain the model's judgment; this file's own job is
// context assembly and the code-enforced persistence invariants
// (live-state.js), not reasoning about meaning.
//
// Note: this endpoint is now AWAITED synchronously by soc-save.js
// (previously fire-and-forget) so the real structured response can
// reach the frontend in the same request — see soc-save.js and SOC.jsx
// for the other half of this change. This is NOT the Generation Barrier
// (Phase D, which guards /api/generate-soc itself) — it only makes a
// single note-save call synchronous end to end.

import { createClient } from '@supabase/supabase-js';
import { loadLiveContext, callLiveSemanticProcessor } from './lib/soc-brain-v2/live-processor.js';
import { applyLiveProcessingResult } from './lib/soc-brain-v2/live-state.js';
import { getPendingClarification, setPendingClarification, clearPendingClarification } from './lib/soc-brain-v2/pending-clarification.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', endpoint: 'process-soc-note', version: 'v2-phase-c' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { session_id, project_id, ao_id, content, openai_key } = req.body || {};
  if (!session_id || !content?.trim()) {
    return res.status(400).json({ error: 'session_id and content are required' });
  }
  const apiKey = openai_key || process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No OpenAI API key available' });

  let noteId = null;
  let sequence = null;

  try {
    // ── 1. Determine sequence and save the raw note immediately ──────────
    // Raw text is saved before any interpretation begins (Pipeline Spec
    // §3) and is never modified afterward by anything in this handler.
    const { count } = await supabase
      .from('soc_notes')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', session_id);
    sequence = (count || 0) + 1;

    const { data: noteRow, error: insertError } = await supabase
      .from('soc_notes')
      .insert({
        session_id, project_id: project_id || null, ao_id: ao_id || null,
        sequence, raw_note: content.trim(),
        processing_status: 'processing',
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    noteId = noteRow.id;

    // ── 2. Assemble context and call the live semantic processor ─────────
    const context = await loadLiveContext(supabase, { sessionId: session_id });
    const pendingClarification = await getPendingClarification(supabase, session_id);

    let modelOutput;
    try {
      modelOutput = await callLiveSemanticProcessor({
        apiKey, context, pendingClarification, noteText: content.trim(),
      });
    } catch (modelErr) {
      // Pipeline Spec §6: a failed semantic-processing call must remain
      // visible and retryable — not silently disappear while generation
      // proceeds as though it succeeded.
      await supabase.from('soc_notes').update({
        processing_status: 'failed', processing_error: modelErr.message,
      }).eq('id', noteId);
      return res.status(200).json({
        ok: false, note_id: noteId, sequence,
        processing_status: 'failed', error: modelErr.message,
        live_response: { required: false, type: null, text: null },
      });
    }

    // ── 3. Apply the result — code-enforced persistence layer ────────────
    const applied = await applyLiveProcessingResult(supabase, {
      sessionId: session_id, noteId, sequence,
      projectId: project_id || null, aoId: ao_id || null,
      modelOutput,
      // Fixed 2026-09-19: the already-active section (from the context
      // loaded above) must be available as a fallback for same_as_current
      // notes, or their claims — and any pending clarification raised
      // while processing them — lose the section identity entirely. See
      // live-state.js for the full reasoning.
      currentSectionId: context.currentSection?.id || null,
    });

    // ── 4. Pending clarification bookkeeping ──────────────────────────────
    if (modelOutput.resolves_pending_clarification && pendingClarification) {
      await clearPendingClarification(supabase, session_id);
    }
    const isNewClarification = modelOutput.live_response?.required && modelOutput.live_response?.type === 'clarification';
    if (isNewClarification) {
      await setPendingClarification(supabase, session_id, {
        clarification_id: `clar-${sequence}`,
        question: modelOutput.live_response.text,
        source_note_id: noteId,
        affected_section_id: applied.section_id,
        created_sequence: sequence,
      });
    }

    // ── 5. Finalise note status and structured response ───────────────────
    const finalStatus = isNewClarification ? 'clarification_required' : 'processed';
    await supabase.from('soc_notes').update({
      processing_status: finalStatus,
      note_status: modelOutput.claims?.some(c => c.amendment_mode) ? 'amended' : 'allocated',
      current_section: applied.section_display_name,
      ai_response: modelOutput.live_response?.required ? modelOutput.live_response.text : null,
      structured_response: modelOutput.live_response,
    }).eq('id', noteId);

    return res.status(200).json({
      ok: true,
      note_id: noteId,
      sequence,
      processing_status: finalStatus,
      current_section: applied.section_display_name,
      section_created: applied.section_created,
      claims_inserted: applied.claims_inserted,
      claims_superseded: applied.claims_superseded,
      live_response: modelOutput.live_response?.required
        ? modelOutput.live_response
        : { required: false, type: null, text: null },
    });

  } catch (err) {
    console.error('[process-soc-note v2] unhandled error:', err.message, err.stack);
    if (noteId) {
      await supabase.from('soc_notes').update({
        processing_status: 'failed', processing_error: err.message,
      }).eq('id', noteId).then(null, () => {});
    }
    return res.status(200).json({
      ok: false, note_id: noteId, sequence,
      processing_status: 'failed', error: err.message,
      live_response: { required: false, type: null, text: null },
    });
  }
}
