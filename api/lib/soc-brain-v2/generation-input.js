// api/lib/soc-brain-v2/generation-input.js
//
// Nora SOC v2, Phase D1 — the canonical generation input.
//
// Confirmed in the D0 audit: generation today deletes the entire
// Phase C resolved state (soc_claims) and rebuilds it from raw text
// via a completely different, older, parallel per-note extraction
// path with no cross-note memory — which is the actual, confirmed
// root cause of both the wrong-room (RB03) symptom and the false
// [UNCLEAR: measurement axis] symptom. This module replaces that: it
// is READ-ONLY with respect to the inspection evidence. It writes
// nothing, deletes nothing, calls no model. It assembles exactly what
// the Inspection State Contract and Pipeline Spec require as
// generation's real input:
//
//   - the immutable raw transcript (ai_messages);
//   - the resolved Phase C state: active claims, superseded claims,
//     and the supersession relationship between them (superseded_by);
//   - the stable sections and their first-visit order.
//
// This is deliberately NOT reconciliation (Phase D2) or drafting
// (Phase D3) - it does not decide what belongs in the final SOC, only
// what the accepted, current evidence actually is. Reconciliation is
// the next stage's job, once built.

/**
 * Assembles the canonical, read-only generation input for one session.
 * Never mutates soc_claims, soc_sections, soc_notes, or ai_messages.
 */
export async function assembleCanonicalGenerationInput(supabase, { sessionId, projectId, aoId }) {
  const { data: transcript, error: transcriptErr } = await supabase
    .from('ai_messages')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .eq('surface', 'soc')
    .order('created_at', { ascending: true });
  if (transcriptErr) throw new Error(`assembleCanonicalGenerationInput: ai_messages: ${transcriptErr.message}`);

  const { data: sections, error: sectionsErr } = await supabase
    .from('soc_sections')
    .select('id, section_key, display_name, floor_level, first_entered_sequence, last_active_sequence, status')
    .eq('session_id', sessionId)
    .order('first_entered_sequence', { ascending: true });
  if (sectionsErr) throw new Error(`assembleCanonicalGenerationInput: soc_sections: ${sectionsErr.message}`);

  const { data: allClaims, error: claimsErr } = await supabase
    .from('soc_claims')
    .select('*')
    .eq('session_id', sessionId)
    .order('note_sequence', { ascending: true })
    .order('claim_sequence', { ascending: true });
  if (claimsErr) throw new Error(`assembleCanonicalGenerationInput: soc_claims: ${claimsErr.message}`);

  const active = (allClaims || []).filter(c => c.status === 'active');
  const superseded = (allClaims || []).filter(c => c.status === 'superseded');

  // Attach each superseded claim's own replacement inline, so the
  // supersession relationship travels with the data itself rather than
  // requiring a second lookup - "650mm remains provenance only" is
  // directly checkable from a single record.
  const supersededWithRelationship = superseded.map(s => ({
    ...s,
    superseded_by_claim: s.superseded_by
      ? active.find(a => a.claim_id === s.superseded_by) || null
      : null,
  }));

  return {
    session_id: sessionId,
    project_id: projectId || null,
    ao_id: aoId || null,
    raw_transcript: (transcript || []).map(m => ({ id: m.id, role: m.role, content: m.content, created_at: m.created_at })),
    sections: (sections || []).map(s => ({
      id: s.id,
      section_key: s.section_key,
      display_name: s.display_name,
      floor_level: s.floor_level,
      first_entered_sequence: s.first_entered_sequence,
      last_active_sequence: s.last_active_sequence,
      status: s.status,
    })),
    claims: {
      active,
      superseded: supersededWithRelationship,
    },
  };
}
