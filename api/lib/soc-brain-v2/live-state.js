// api/lib/soc-brain-v2/live-state.js
//
// Nora SOC v2, Phase C — the code-enforced layer sitting beneath the live
// semantic processor. The model decides MEANING (is this a return to an
// existing room, is this a correction or an addition); this module
// guarantees the INVARIANTS that don't require judgment (Master
// Instructions governing principle: "use code to guarantee facts that do
// not require judgment") — a section is never duplicated, its first-visit
// position never moves once set, claim persistence is atomic.
//
// Deliberately kept separate from the model-calling code (live-processor.js)
// so this layer — the part actually responsible for correctness — is
// directly testable without needing a live model call.

/**
 * Normalises a display name into a stable, lowercase, underscore-separated
 * key, for matching a section resolution against the existing section
 * index deterministically.
 */
export function normaliseSectionKey(displayName) {
  return String(displayName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Builds the section index text handed to the live processor — every
 * section established so far in this inspection, its key, and whether
 * it's currently active. Kept as plain, compact text (not JSON) since
 * this is prompt content, not a machine-consumed value.
 */
export function buildSectionIndexText(sections, currentSectionId) {
  if (!sections?.length) return 'No sections established yet — this is the first note of the inspection.';
  return sections
    .map(s => `- key="${s.section_key}" display_name="${s.display_name}"${s.floor_level ? ` floor_level="${s.floor_level}"` : ''}${s.id === currentSectionId ? ' (CURRENTLY ACTIVE)' : ''}`)
    .join('\n');
}

/**
 * Resolves a model's section_resolution output against soc_sections,
 * enforcing the Inspection State Contract's invariants directly in code:
 * - a section is reused, never duplicated, when the model says so;
 * - first_entered_sequence is set exactly once, on genuine first creation,
 *   and never changes afterward, regardless of how many times the
 *   section is later reactivated;
 * - last_active_sequence always advances to the current note.
 *
 * Returns { section_id, display_name, created } — created is true only
 * when a genuinely new row was inserted.
 */
export async function resolveSection(supabase, { sessionId, projectId, aoId, sequence, resolution }) {
  if (!resolution || resolution.action === 'same_as_current') return null;

  const key = resolution.section_key
    ? normaliseSectionKey(resolution.section_key)
    : normaliseSectionKey(resolution.display_name);

  if (!key) return null;

  const { data: existing } = await supabase
    .from('soc_sections')
    .select('id, display_name, first_entered_sequence')
    .eq('session_id', sessionId)
    .eq('section_key', key)
    .maybeSingle();

  if (existing) {
    // Reactivation — first_entered_sequence is NEVER touched here. This is
    // the direct, code-level guarantee behind "a return to an earlier
    // room does not move it from its original position."
    await supabase
      .from('soc_sections')
      .update({ last_active_sequence: sequence, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    return { section_id: existing.id, display_name: existing.display_name, created: false };
  }

  // Genuine first entry — first_entered_sequence set exactly once, here.
  const { data: created, error } = await supabase
    .from('soc_sections')
    .insert({
      session_id: sessionId,
      project_id: projectId || null,
      ao_id: aoId || null,
      section_key: key,
      display_name: resolution.display_name || key,
      floor_level: resolution.floor_level || null,
      first_entered_sequence: sequence,
      last_active_sequence: sequence,
      status: 'active',
    })
    .select('id, display_name')
    .single();

  // A concurrent note could race to create the same section between the
  // lookup above and this insert — the unique (session_id, section_key)
  // constraint (Phase B) is the real backstop. On that specific race,
  // re-fetch and reuse rather than erroring the whole note.
  if (error) {
    const { data: raced } = await supabase
      .from('soc_sections')
      .select('id, display_name')
      .eq('session_id', sessionId)
      .eq('section_key', key)
      .maybeSingle();
    if (raced) return { section_id: raced.id, display_name: raced.display_name, created: false };
    throw error;
  }

  return { section_id: created.id, display_name: created.display_name, created: true };
}

/**
 * Applies a live processing model result: resolves the section, builds
 * the claim rows for the (Phase B-fixed) atomic RPC, calls it with the
 * real note id and resolved section id, and returns what actually
 * happened — for the caller to persist as the note's lifecycle status
 * and structured response.
 *
 * currentSectionId is the id of whichever section was already active
 * before this note (from the context loadLiveContext already
 * assembled) — distinct from sectionResult, which is only non-null
 * when THIS note itself caused a section change (a reactivation or a
 * genuine new section). See the section_id resolution below for why
 * that distinction matters.
 */
export async function applyLiveProcessingResult(supabase, {
  sessionId, noteId, sequence, projectId, aoId, modelOutput, currentSectionId = null,
}) {
  const sectionResult = await resolveSection(supabase, {
    sessionId, projectId, aoId, sequence,
    resolution: modelOutput.section_resolution,
  });

  const sectionText = sectionResult?.display_name || modelOutput.section_resolution?.display_name || null;
  // Fixed 2026-09-19: resolveSection() correctly returns null for
  // action: 'same_as_current' - no section write is needed when
  // nothing changes. But that null was being used directly as this
  // note's section_id, meaning every claim from an ordinary
  // same_as_current note (i.e. almost every note in a real
  // inspection) was persisted with section_id: null - invisible to
  // the recent-context query in live-processor.js, which filters
  // strictly by section_id. Confirmed live: this made a correction
  // ("actually, that's 450, not 650") unable to see the very crack
  // claim it was correcting, despite that claim being fully present
  // and correct in the database.
  //
  // "No NEW section result" (sectionResult is null) and "no CURRENT
  // section" (currentSectionId is null) are different states - only
  // the second one means there is genuinely no active section yet
  // (e.g. the very first note of an inspection, before any section
  // exists at all). This falls back to the already-active section's
  // id in the first case, and only allows a genuine null in the
  // second - matching the stated invariant: every substantive claim
  // made while a section is active belongs to it unless the model
  // itself transitioned, returned, or reassigned it elsewhere.
  const sectionId = sectionResult?.section_id || currentSectionId || null;

  const claims = (modelOutput.claims || []).map((c, i) => ({
    claim_id: `c-${sequence}-${i + 1}`,
    sequence: i + 1,
    claim_type: c.claim_type,
    section: sectionText,
    element: c.element ?? null,
    construction: c.construction ?? null,
    finish: c.finish ?? null,
    condition: c.condition ?? null,
    defect_type: c.defect_type ?? null,
    location: c.location ?? null,
    direction: c.direction ?? null,
    measurement: c.measurement ?? null,
    extent: c.extent ?? null,
    operational_result: c.operational_result ?? null,
    access_limitation: c.access_limitation ?? null,
    raw_fragment: c.raw_fragment ?? null,
    amendment_mode: c.amendment_mode ?? null,
    confidence: c.confidence || 'high',
    status: 'active',
    content: c.raw_fragment || '',
  }));

  const hasAmendment = claims.some(c => c.amendment_mode);

  const { data: rpcResult, error } = await supabase.rpc('process_soc_note_atomic', {
    p_session_id: sessionId,
    p_note_id: noteId,
    p_sequence: sequence,
    // Fixed 2026-09-19: this was JSON.stringify(claims). The Supabase
    // JS client already serialises a native array/object into JSONB
    // correctly for a jsonb-typed RPC parameter. Pre-stringifying it
    // here meant the client sent a JSON *string* containing the array's
    // text, not the array itself - so Postgres received p_claims as a
    // jsonb scalar (a string), not a jsonb array, and
    // jsonb_array_elements(p_claims) correctly rejected it with
    // "cannot extract elements from a scalar". Confirmed live: every
    // note reaching this call failed here, after section resolution
    // (a separate, already-committed write) had already succeeded.
    p_claims: claims,
    p_section: sectionText,
    p_note_type: hasAmendment ? 'amendment' : (claims.every(c => c.claim_type === 'contextual' || c.claim_type === 'section_declaration') && claims.length ? 'contextual' : 'observation'),
    p_correction_mode: hasAmendment ? (claims.find(c => c.amendment_mode)?.amendment_mode || 'replace') : null,
    p_project_id: projectId || null,
    p_ao_id: aoId || null,
    p_section_id: sectionId,
  });

  if (error) throw new Error(`process_soc_note_atomic failed: ${error.message}`);

  return {
    section_id: sectionId,
    section_display_name: sectionText,
    section_created: sectionResult?.created || false,
    claims_inserted: rpcResult?.claims_inserted ?? 0,
    claims_superseded: rpcResult?.claims_superseded ?? 0,
  };
}
