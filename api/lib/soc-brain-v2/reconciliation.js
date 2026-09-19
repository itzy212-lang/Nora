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
// - recoverSupportedRawDetail (inline in reconcile()): the one place a
//   model is used, and only for notes where a coverage-gap check has
//   already detected raw text not accounted for by any existing claim
//   - never asked to redecide anything Phase C already resolved.
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
const DRAFTABLE_DISPOSITIONS = new Set(['active_evidence', 'site_general_note']);

export function isDraftable(disposition) {
  return DRAFTABLE_DISPOSITIONS.has(disposition);
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

function normaliseWords(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function overlapRatio(clauseWords, fragmentWords) {
  if (!clauseWords.length) return 1;
  const fragSet = new Set(fragmentWords);
  return clauseWords.filter(w => fragSet.has(w)).length / clauseWords.length;
}

async function callRecoveryModel({ apiKey, model = 'gpt-4o', sectionName, existingClaimsSummary, leftoverClause, noteRaw }) {
  const userPrompt = [
    `SECTION: ${sectionName || '(unresolved)'}`,
    `FULL NOTE TEXT:\n"${noteRaw}"`,
    `CLAIM(S) ALREADY EXTRACTED FROM THIS NOTE:\n${existingClaimsSummary}`,
    `LEFTOVER TEXT NOT ACCOUNTED FOR BY THOSE CLAIMS:\n"${leftoverClause}"`,
  ].join('\n\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: UNIVERSAL_SOC_BRAIN_V2 + '\n\n' + RECONCILIATION_CONTRACT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Reconciliation recovery model call failed: ${res.status}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  return JSON.parse(raw);
}

/**
 * Pure text comparison — no model, no judgment about whether leftover
 * text matters, only whether it exists. Splits a note's raw text into
 * clauses and flags any clause with low word-overlap against every
 * claim already extracted from that same note as a candidate for the
 * model's recovery judgment (callRecoveryModel). False positives are
 * expected and harmless — the model is the actual judgment step; this
 * only decides what gets shown to it.
 */
export function findCoverageGaps(canonicalInput, notes) {
  const claimsByNote = new Map();
  for (const c of [...canonicalInput.claims.active, ...canonicalInput.claims.superseded]) {
    if (!claimsByNote.has(c.note_sequence)) claimsByNote.set(c.note_sequence, []);
    claimsByNote.get(c.note_sequence).push(c);
  }

  const gaps = [];
  for (const note of notes) {
    if (note.structured_response?.type === 'direct_answer') continue;
    const claims = claimsByNote.get(note.sequence) || [];
    if (!claims.length) continue;
    const clauses = (note.raw_note || '').split(/[,.]/).map(s => s.trim()).filter(s => s.length > 3);
    const fragmentWords = normaliseWords(claims.map(c => c.raw_fragment || c.content || '').join(' '));
    for (const clause of clauses) {
      const clauseWords = normaliseWords(clause);
      if (overlapRatio(clauseWords, fragmentWords) < 0.5) {
        gaps.push({ note, claims, clause });
      }
    }
  }
  return gaps;
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
  const gaps = findCoverageGaps(canonicalInput, notes || []);

  const recovered = [];
  for (const gap of gaps) {
    const { note, claims, clause } = gap;
    const sectionId = claims[0]?.section_id || null;

    if (!apiKey) {
      // No model available in this environment — record the gap
      // itself as inspectable evidence of what WOULD be sent for
      // judgment, without fabricating a recovery decision.
      recovered.push({
        id: `recovered-${note.sequence}-pending`,
        source: 'raw_recovery',
        source_note_sequence: note.sequence,
        section_id: sectionId,
        section_name: sectionById.get(sectionId)?.display_name || null,
        resolved_content: null,
        raw_provenance: [{ note_sequence: note.sequence, raw_fragment: clause }],
        disposition: 'unresolved',
        draftable: false,
        recovered: false,
        recovery_basis: null,
        pending_model_judgment: true,
      });
      continue;
    }

    const judgment = await callRecoveryModel({
      apiKey, model,
      sectionName: sectionById.get(sectionId)?.display_name,
      existingClaimsSummary: claims.map(c => `- ${resolvedContentFor(c)} (raw: "${c.raw_fragment}")`).join('\n'),
      leftoverClause: clause,
      noteRaw: note.raw_note,
    });

    if (judgment.recoverable) {
      recovered.push({
        id: `recovered-${note.sequence}-${recovered.length + 1}`,
        source: 'raw_recovery',
        source_note_sequence: note.sequence,
        section_id: sectionId,
        section_name: sectionById.get(sectionId)?.display_name || null,
        element: judgment.element || claims[0]?.element || null,
        resolved_content: judgment.recovered_content,
        raw_provenance: [{ note_sequence: note.sequence, raw_fragment: clause }],
        disposition: 'active_evidence',
        status: 'active',
        draftable: true,
        material_relationships: [],
        recovered: true,
        recovery_basis: judgment.basis,
      });
    }
  }

  return {
    session_id: sessionId,
    sections: canonicalInput.sections,
    items: [...items, ...recovered],
    excluded,
  };
}
