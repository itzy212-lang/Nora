// api/lib/soc-brain-v2/reconciliation.js
//
// Nora SOC v2, Phase D2 — the reconciliation layer.
//
// Consumes the canonical, read-only D1 input (raw transcript +
// resolved Phase C state + stable sections) and produces an
// inspectable reconciliation representation for the (not-yet-built)
// drafting stage. Does not draft prose. Does not call the generation
// barrier itself (the caller is expected to have already checked it,
// matching D1's separation of "is it safe to read" from "what does
// the evidence say").
//
// Two genuinely different kinds of work, kept deliberately separate:
// - buildDeterministicItems: pure code, no model, maps every existing
//   Phase C claim (active and superseded) into a reconciliation item.
//   Disposition, section, status and supersession are Phase C's
//   resolved decisions - reconciliation does not re-derive or
//   second-guess them, only represents them.
// - checkNoteCompleteness: the one place a model is used - a genuine
//   per-note semantic completeness check, called for every
//   substantive note (any note with at least one Phase C claim), with
//   no lexical pre-filter deciding whether to skip it. Fixed
//   2026-09-19, D2 acceptance correction: an earlier design used
//   word-overlap to gate which notes even reached the model, split by
//   clause. Confirmed, directly and reproducibly, to cause a genuine
//   false negative: "The party wall has a plaster and emulsion finish
//   and shows a hairline crack near the door" — two distinct facts
//   joined by "and", no comma/period boundary — scored as fully
//   covered by a claim representing only the first fact, because that
//   claim's own vocabulary overlapped enough of the whole sentence's
//   words to clear the per-clause threshold. The second fact would
//   have been silently lost. Word overlap is no longer used to decide
//   whether to call the model at all; every substantive note gets a
//   real semantic check.
//
// Every substantive raw transcript fragment ends up in exactly one of:
// items (an existing claim, active or superseded), excluded
// (explicitly accounted-for non-evidence), or a recovered item (raw
// detail genuinely missing from state) - never silently dropped.

import { assembleCanonicalGenerationInput } from './generation-input.js';
import { RECONCILIATION_CONTRACT } from './reconciliation-contract.js';
import { UNIVERSAL_SOC_BRAIN_V2 } from './universal-soc-brain.js';

// Dispositions Phase C already assigns that represent a genuine,
// schedulable property fact. Everything else (superseded, duplicate,
// navigation_context, unresolved) is retained for provenance/audit
// but is never draftable. This is a deterministic rule, not a
// judgment call, so it is enforced here in code rather than left to
// any model to decide per item.
// Fixed 2026-09-19, final integration phase: site_general_note was
// previously included here, which meant a correctly classified site
// note flowed into per-section room drafting purely because some
// room happened to be active when it was dictated - the live
// acceptance run showed the garden-access note drafted as a row
// inside First Floor Rear Bedroom. A site/general note is real,
// draftable evidence, but it is not room evidence: it must never
// enter the per-section room-drafting pool in the first place. See
// isSiteNote() below and reconcile()'s separate site_notes output -
// the fix is upstream of D3, not a D4 severity change, per explicit
// instruction: D4's wrong_section check is unchanged and remains a
// defence layer for exactly this failure mode, not the primary fix.
const DRAFTABLE_DISPOSITIONS = new Set(['active_evidence']);

// Site/general notes are genuine, final-SOC-bound evidence - just not
// room evidence. Kept as a distinct predicate so callers (the
// production pipeline) can retrieve them explicitly rather than
// inferring "not draftable" as "site note" (an unresolved or
// superseded item is also not draftable, and is not a site note).
const SITE_NOTE_DISPOSITIONS = new Set(['site_general_note']);

export function isDraftable(disposition) {
  return DRAFTABLE_DISPOSITIONS.has(disposition);
}

export function isSiteNote(disposition) {
  return SITE_NOTE_DISPOSITIONS.has(disposition);
}

function resolvedContentFor(claim) {
  // A short, human-readable rendering of a claim's resolved facts -
  // for inspection/proof purposes, not drafted prose. Drafting (D3)
  // will do the actual professional wording.
  const parts = [claim.element, claim.defect_type, claim.construction, claim.finish, claim.condition, claim.measurement, claim.direction, claim.location]
    .filter(Boolean);
  return parts.length ? parts.join(', ') : (claim.content || claim.raw_fragment || '');
}

/**
 * Maps every existing Phase C claim (active and superseded) into a
 * reconciliation item. Pure function, no model, no I/O - the
 * canonical input already has everything needed.
 */
export function buildDeterministicItems(canonicalInput) {
  const sectionById = new Map(canonicalInput.sections.map(s => [s.id, s]));
  const activeByClaimId = new Map(canonicalInput.claims.active.map(c => [c.claim_id, c]));

  const items = [];

  for (const claim of canonicalInput.claims.active) {
    const section = sectionById.get(claim.section_id) || null;
    items.push({
      id: claim.claim_id,
      source: 'state',
      source_note_sequence: claim.note_sequence,
      source_claim_id: claim.claim_id,
      section_id: claim.section_id,
      section_name: section?.display_name || claim.section || null,
      element: claim.element,
      resolved_content: resolvedContentFor(claim),
      raw_provenance: [{ note_sequence: claim.note_sequence, raw_fragment: claim.raw_fragment }],
      disposition: claim.disposition,
      status: claim.status,
      superseded_by: null,
      draftable: isDraftable(claim.disposition),
      is_site_note: isSiteNote(claim.disposition),
      material_relationships: [],
      recovered: false,
      recovery_basis: null,
    });
  }

  for (const claim of canonicalInput.claims.superseded) {
    const section = sectionById.get(claim.section_id) || null;
    const replacement = claim.superseded_by_claim || activeByClaimId.get(claim.superseded_by) || null;
    items.push({
      id: claim.claim_id,
      source: 'state',
      source_note_sequence: claim.note_sequence,
      source_claim_id: claim.claim_id,
      section_id: claim.section_id,
      section_name: section?.display_name || claim.section || null,
      element: claim.element,
      resolved_content: resolvedContentFor(claim),
      raw_provenance: [{ note_sequence: claim.note_sequence, raw_fragment: claim.raw_fragment }],
      disposition: claim.disposition, // Phase C already sets this to 'superseded'
      status: claim.status,
      superseded_by: claim.superseded_by,
      // Superseded evidence is retained as provenance (full original
      // detail stays on this item) but is never draftable, regardless
      // of disposition wording - enforced by isDraftable(), not by
      // trusting the disposition string alone.
      draftable: false,
      is_site_note: false, // a superseded claim's disposition is always 'superseded', never site_general_note
      material_relationships: replacement
        ? [{ type: 'superseded_by', target_id: replacement.claim_id, target_resolved_content: resolvedContentFor(replacement) }]
        : [],
      recovered: false,
      recovery_basis: null,
    });
  }

  return items;
}

/**
 * Explicitly accounts for conversational/non-evidence material so it
 * is never silently dropped: direct questions and the responses to
 * them, identified by the structured_response.type Phase C already
 * recorded — not by any keyword/heuristic guess at intent.
 */
export function classifyExcludedMaterial(notes) {
  const excluded = [];
  for (const note of notes) {
    const type = note.structured_response?.type;
    if (type === 'direct_answer') {
      excluded.push({ note_sequence: note.sequence, raw_fragment: note.raw_note, reason: 'direct_question', source: 'raw_transcript' });
      if (note.structured_response?.text) {
        excluded.push({ note_sequence: note.sequence, raw_fragment: note.structured_response.text, reason: 'assistant_response', source: 'soc_notes.structured_response' });
      }
    }
  }
  return excluded;
}

// Diagnostic-only lexical signal — never used to decide whether the
// completeness model call happens. Kept purely so the reconciliation
// output can show, for inspection, roughly how much new information a
// note's recovery step actually added; has no bearing on correctness.
function wordOverlapSignal(noteText, claims) {
  const normalise = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const noteWords = normalise(noteText);
  if (!noteWords.length) return 1;
  const fragWords = new Set(normalise(claims.map(c => c.raw_fragment || c.content || '').join(' ')));
  return noteWords.filter(w => fragWords.has(w)).length / noteWords.length;
}

/**
 * Terra (gpt-5.6-terra) is Nora's established production model for
 * SOC-related model calls (see draftFromClaims, api/lib/soc-pipeline.js)
 * - used here as primary, matching its exact existing invocation
 * pattern rather than inventing a new one: the 'developer' role for
 * its system message (not 'system' - a real API-level distinction for
 * this model family), max_completion_tokens (not max_tokens), no
 * forced response_format (Terra is not called with strict JSON mode
 * anywhere in this codebase - draftFromClaims relies on prompt
 * instruction + tolerant parsing instead, which is proven to work
 * reliably there), and the same gpt-4o fallback on failure already
 * established for drafting. gpt-4o alone was used in the first D2
 * draft only because it was this module's own, unexamined default -
 * not for any technical reason; there is none.
 */
async function callReconciliationModel({ apiKey, systemContent, userPrompt, primaryModel = 'gpt-5.6-terra', fallbackModel = 'gpt-4o' }) {
  async function attempt(model) {
    const isTerra = model.startsWith('gpt-5.6');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        ...(isTerra ? { max_completion_tokens: 4000 } : { max_tokens: 4000, response_format: { type: 'json_object' } }),
        messages: [
          { role: isTerra ? 'developer' : 'system', content: systemContent },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Reconciliation model call failed (${model}): ${res.status}`);
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || '')
      .replace(/^[`]{3}(?:json)?[\s]*/m, '').replace(/[\s]*[`]{3}$/m, '').trim();
    return JSON.parse(raw);
  }

  try {
    return await attempt(primaryModel);
  } catch (primaryErr) {
    if (primaryModel === fallbackModel) throw primaryErr;
    return await attempt(fallbackModel);
  }
}

/**
 * Genuine per-note semantic completeness check — the model is given
 * the note's complete raw text and every claim already extracted from
 * it, and decides directly whether anything factual is missing. No
 * lexical pre-filter decides whether this runs; every substantive
 * note (caller: any note with at least one claim) gets it.
 */
async function checkNoteCompleteness({ apiKey, model, sectionName, note, claims }) {
  const userPrompt = [
    `SECTION: ${sectionName || '(unresolved)'}`,
    `COMPLETE NOTE TEXT:\n"${note.raw_note}"`,
    `CLAIM(S) ALREADY EXTRACTED FROM THIS NOTE:\n${claims.map(c => `- ${resolvedContentFor(c)} (raw: "${c.raw_fragment}")`).join('\n')}`,
  ].join('\n\n');

  return callReconciliationModel({
    apiKey,
    systemContent: UNIVERSAL_SOC_BRAIN_V2 + '\n\n' + RECONCILIATION_CONTRACT,
    userPrompt,
    primaryModel: model || 'gpt-5.6-terra',
  });
}

/**
 * Full D2 reconciliation. Read-only with respect to inspection
 * evidence — calls assembleCanonicalGenerationInput (D1) and reads
 * soc_notes for structured_response/ai_response, writes nothing
 * anywhere.
 */
export async function reconcile(supabase, { sessionId, projectId, aoId, apiKey, model }) {
  const canonicalInput = await assembleCanonicalGenerationInput(supabase, { sessionId, projectId, aoId });

  const { data: notes, error: notesErr } = await supabase
    .from('soc_notes')
    .select('sequence, raw_note, structured_response')
    .eq('session_id', sessionId)
    .order('sequence', { ascending: true });
  if (notesErr) throw new Error(`reconcile: could not load soc_notes: ${notesErr.message}`);

  const items = buildDeterministicItems(canonicalInput);
  const excluded = classifyExcludedMaterial(notes || []);
  const sectionById = new Map(canonicalInput.sections.map(s => [s.id, s]));

  const claimsByNote = new Map();
  for (const c of [...canonicalInput.claims.active, ...canonicalInput.claims.superseded]) {
    if (!claimsByNote.has(c.note_sequence)) claimsByNote.set(c.note_sequence, []);
    claimsByNote.get(c.note_sequence).push(c);
  }

  const recovered = [];
  for (const note of (notes || [])) {
    if (note.structured_response?.type === 'direct_answer') continue; // already excluded, not evidence
    const claims = claimsByNote.get(note.sequence) || [];
    if (!claims.length) continue; // nothing to check completeness against

    const sectionId = claims[0]?.section_id || null;
    const sectionName = sectionById.get(sectionId)?.display_name || null;
    const coverageSignal = wordOverlapSignal(note.raw_note, claims); // diagnostic only

    if (!apiKey) {
      // No model available in this environment — record that a
      // completeness check is owed here as inspectable, honest
      // incompleteness, rather than silently skipping it or
      // fabricating a result. Never used to imply the note IS fully
      // covered.
      recovered.push({
        id: `completeness-pending-${note.sequence}`,
        source: 'raw_recovery',
        source_note_sequence: note.sequence,
        section_id: sectionId,
        section_name: sectionName,
        resolved_content: null,
        raw_provenance: [{ note_sequence: note.sequence, raw_fragment: note.raw_note }],
        disposition: 'unresolved',
        draftable: false,
        recovered: false,
        recovery_basis: null,
        coverage_signal: coverageSignal,
        pending_model_judgment: true,
      });
      continue;
    }

    const judgment = await checkNoteCompleteness({ apiKey, model, sectionName, note, claims });
    for (const r of (judgment.recovered || [])) {
      recovered.push({
        id: `recovered-${note.sequence}-${recovered.length + 1}`,
        source: 'raw_recovery',
        source_note_sequence: note.sequence,
        section_id: sectionId,
        section_name: sectionName,
        element: r.element || claims[0]?.element || null,
        resolved_content: r.recovered_content,
        raw_provenance: [{ note_sequence: note.sequence, raw_fragment: note.raw_note }],
        disposition: 'active_evidence',
        status: 'active',
        draftable: true,
        material_relationships: [],
        recovered: true,
        recovery_basis: r.basis,
        coverage_signal: coverageSignal,
      });
    }
  }

  const allItems = [...items, ...recovered];

  return {
    session_id: sessionId,
    sections: canonicalInput.sections,
    items: allItems,
    // Site/general notes, surfaced explicitly so downstream (the
    // production pipeline) never needs to re-derive "is this a site
    // note" from draftable/disposition inference - they remain in
    // `items` too (full evidence accounting is preserved), this is
    // an additional, convenient view onto the same data, not a
    // separate source of truth.
    site_notes: allItems.filter(i => i.is_site_note),
    excluded,
  };
}
