// api/lib/__tests__/soc-reconciliation.test.js
//
// Phase D2 — regression tests for the reconciliation layer. Uses the
// same real functions run directly against a faithful reconstruction
// of the accepted acceptance fixture (d9b94662-...) during this
// phase's implementation - these tests encode the same proof, so it
// cannot regress unnoticed. Per explicit instruction, nothing here
// hard-codes "bugatti", room names, or measurements as production
// logic - only as realistic test fixture data, matching how the fix
// was actually verified.

import { describe, it, expect } from 'vitest';
import { buildDeterministicItems, classifyExcludedMaterial, isDraftable, isSiteNote, reconcile } from '../soc-brain-v2/reconciliation.js';

const FB = 'sec-front';
const RB = 'sec-rear';
const sections = [
  { id: FB, display_name: 'First Floor Front Bedroom', first_entered_sequence: 1 },
  { id: RB, display_name: 'First Floor Rear Bedroom', first_entered_sequence: 6 },
];

describe('isDraftable — the deterministic, code-enforced rule', () => {
  it('only active_evidence is room-draftable (fixed final integration phase: site_general_note removed)', () => {
    expect(isDraftable('active_evidence')).toBe(true);
    expect(isDraftable('site_general_note')).toBe(false);
    expect(isDraftable('superseded')).toBe(false);
    expect(isDraftable('duplicate')).toBe(false);
    expect(isDraftable('navigation_context')).toBe(false);
    expect(isDraftable('unresolved')).toBe(false);
  });
});

describe('isSiteNote — the distinct predicate for site/general notes', () => {
  it('is true only for site_general_note', () => {
    expect(isSiteNote('site_general_note')).toBe(true);
    expect(isSiteNote('active_evidence')).toBe(false);
    expect(isSiteNote('superseded')).toBe(false);
    expect(isSiteNote('navigation_context')).toBe(false);
  });
});

describe('buildDeterministicItems — supersession retained as provenance, never draftable', () => {
  it('a superseded claim keeps its full original detail but is marked non-draftable, with the replacement linked', () => {
    const active = [{ claim_id: 'c-5-1', note_sequence: 5, section_id: FB, element: 'party wall', defect_type: 'hairline crack', measurement: '450mm', direction: 'diagonally up', location: 'corner', disposition: 'active_evidence', status: 'active', raw_fragment: "Actually, that's 450, not 650." }];
    const superseded = [{ claim_id: 'c-4-1', note_sequence: 4, section_id: FB, element: 'party wall', defect_type: 'hairline crack', measurement: '650mm', direction: 'diagonally up', location: 'corner', disposition: 'superseded', status: 'superseded', superseded_by: 'c-5-1', superseded_by_claim: active[0], raw_fragment: 'hairline crack, 650mm, diagonally up from the corner' }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded } });
    const item = items.find(i => i.id === 'c-4-1');
    expect(item.status).toBe('superseded');
    expect(item.draftable).toBe(false);
    // Full original detail (provenance) is retained, not erased.
    expect(item.resolved_content).toContain('650mm');
    expect(item.raw_provenance[0].raw_fragment).toContain('650mm');
    expect(item.material_relationships[0]).toMatchObject({ type: 'superseded_by', target_id: 'c-5-1' });
    // 650mm must never appear as an active fact anywhere in the output.
    expect(items.some(i => i.status === 'active' && i.resolved_content.includes('650mm'))).toBe(false);
  });

  it('the active replacement is draftable and carries the corrected value', () => {
    const active = [{ claim_id: 'c-5-1', note_sequence: 5, section_id: FB, element: 'party wall', measurement: '450mm', disposition: 'active_evidence', status: 'active', raw_fragment: 'x' }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded: [] } });
    expect(items[0].draftable).toBe(true);
    expect(items[0].resolved_content).toContain('450mm');
  });

  it('section integrity: every item carries the correct section_id, never inferred from nearby items', () => {
    const active = [
      { claim_id: 'c-a', note_sequence: 1, section_id: FB, element: 'x', disposition: 'active_evidence', status: 'active', raw_fragment: 'a' },
      { claim_id: 'c-b', note_sequence: 2, section_id: RB, element: 'y', disposition: 'active_evidence', status: 'active', raw_fragment: 'b' },
    ];
    const items = buildDeterministicItems({ sections, claims: { active, superseded: [] } });
    expect(items.find(i => i.id === 'c-a').section_name).toBe('First Floor Front Bedroom');
    expect(items.find(i => i.id === 'c-b').section_name).toBe('First Floor Rear Bedroom');
  });

  it('a clarification lifecycle (unresolved -> superseded -> resolved answer) reconciles cleanly, never as [UNCLEAR]', () => {
    const active = [{ claim_id: 'c-14-1', note_sequence: 14, section_id: FB, element: 'party wall', measurement: '200mm', disposition: 'active_evidence', status: 'active', raw_fragment: 'The party wall.' }];
    const superseded = [{ claim_id: 'c-13-1', note_sequence: 13, section_id: FB, element: null, disposition: 'superseded', status: 'superseded', superseded_by: 'c-14-1', superseded_by_claim: active[0], raw_fragment: "There's a crack on the wall, about 200 millimetres." }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded } });
    const answer = items.find(i => i.id === 'c-14-1');
    const question = items.find(i => i.id === 'c-13-1');
    expect(answer.draftable).toBe(true);
    expect(answer.disposition).toBe('active_evidence');
    expect(question.draftable).toBe(false);
    expect(question.material_relationships[0].target_id).toBe('c-14-1');
    // The resolved answer must have ended up in the correct section, not stranded.
    expect(answer.section_name).toBe('First Floor Front Bedroom');
  });
});

describe('classifyExcludedMaterial — conversational material never silently dropped', () => {
  it('a direct question and its response are both explicitly accounted for as non-evidence', () => {
    const notes = [{ sequence: 15, raw_note: 'How many rooms have I recorded so far?', structured_response: { type: 'direct_answer', text: 'You have recorded two rooms.' } }];
    const excluded = classifyExcludedMaterial(notes);
    expect(excluded.length).toBe(2);
    expect(excluded.some(e => e.reason === 'direct_question')).toBe(true);
    expect(excluded.some(e => e.reason === 'assistant_response')).toBe(true);
  });

  it('an ordinary observation is not excluded', () => {
    const notes = [{ sequence: 2, raw_note: 'The party wall has a plaster finish.', structured_response: { type: null } }];
    expect(classifyExcludedMaterial(notes)).toEqual([]);
  });

  it('a correction confirmation is not treated as a direct question', () => {
    const notes = [{ sequence: 5, raw_note: "Actually, that's 450, not 650.", structured_response: { type: 'correction_confirmation', text: 'Updated.' } }];
    expect(classifyExcludedMaterial(notes)).toEqual([]);
  });
});

describe('reconcile() — false-negative fix: every substantive note is semantically checked, not lexically gated (2026-09-19 correction)', () => {
  it('calls the completeness model for a note even when a lexical-overlap heuristic would have scored it as fully covered', async () => {
    // The exact scenario confirmed, directly, to be a real false negative
    // under the old per-clause word-overlap gate: two facts joined by
    // "and" with no comma/period boundary, where the first claim's own
    // vocabulary overlaps enough of the whole sentence to clear a 0.5
    // per-clause threshold, hiding the second fact from ever reaching a
    // model. reconcile() must now call the model regardless — there is
    // no lexical gate left that could suppress this call.
    let modelCalled = false;
    global.fetch = async (url, opts) => {
      modelCalled = true;
      const body = JSON.parse(opts.body);
      expect(body.model).toBe('gpt-5.6-terra'); // primary model, per acceptance correction
      expect(body.messages[0].role).toBe('developer'); // Terra's established invocation pattern
      expect(body.max_completion_tokens).toBeDefined();
      expect(body.response_format).toBeUndefined(); // Terra is not called with forced JSON mode anywhere in this codebase
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ fully_covered: false, recovered: [{ recovered_content: 'hairline crack near the door', element: 'party wall', basis: 'shows a hairline crack near the door' }] }) } }] }) };
    };

    const supabase = {
      from: (table) => {
        if (table === 'soc_notes') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ sequence: 20, raw_note: 'The party wall has a plaster and emulsion finish and shows a hairline crack near the door', structured_response: { type: null } }], error: null }) }) }) };
        if (table === 'soc_sections') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ id: 'sec-x', section_key: 'x', display_name: 'Test Room', first_entered_sequence: 1 }], error: null }) }) }) };
        if (table === 'ai_messages') return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
        if (table === 'soc_claims') return { select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [{ claim_id: 'c-x-1', note_sequence: 20, section_id: 'sec-x', status: 'active', disposition: 'active_evidence', element: 'party wall', condition: 'plaster and emulsion finish', raw_fragment: 'The party wall has a plaster and emulsion finish' }], error: null }) }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await reconcile(supabase, { sessionId: 's1', apiKey: 'test-key' });
    expect(modelCalled).toBe(true);
    const recoveredItem = result.items.find(i => i.recovered);
    expect(recoveredItem).toBeDefined();
    expect(recoveredItem.resolved_content).toContain('hairline crack');
    expect(recoveredItem.draftable).toBe(true);
  });

  it('falls back to gpt-4o if Terra fails, matching the established drafting fallback pattern', async () => {
    let calls = [];
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body.model);
      if (body.model === 'gpt-5.6-terra') return { ok: false, status: 500 };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ fully_covered: true, recovered: [] }) } }] }) };
    };
    const supabase = {
      from: (table) => {
        if (table === 'soc_notes') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ sequence: 1, raw_note: 'x', structured_response: { type: null } }], error: null }) }) }) };
        if (table === 'soc_sections') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
        if (table === 'ai_messages') return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
        if (table === 'soc_claims') return { select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [{ claim_id: 'c-1-1', note_sequence: 1, section_id: null, status: 'active', disposition: 'active_evidence', raw_fragment: 'x' }], error: null }) }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    };
    await reconcile(supabase, { sessionId: 's1', apiKey: 'test-key' });
    expect(calls).toEqual(['gpt-5.6-terra', 'gpt-4o']);
  });
});

describe('honest incompleteness when no model is available (no apiKey)', () => {
  it('marks a substantive note as pending judgment rather than fabricating or silently skipping a completeness result', async () => {
    const supabase = {
      from: (table) => {
        if (table === 'soc_notes') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ sequence: 1, raw_note: 'x', structured_response: { type: null } }], error: null }) }) }) };
        if (table === 'soc_sections') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
        if (table === 'ai_messages') return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
        if (table === 'soc_claims') return { select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [{ claim_id: 'c-1-1', note_sequence: 1, section_id: null, status: 'active', disposition: 'active_evidence', raw_fragment: 'x' }], error: null }) }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    };
    const result = await reconcile(supabase, { sessionId: 's1' }); // no apiKey
    const pending = result.items.find(i => i.pending_model_judgment);
    expect(pending).toBeDefined();
    expect(pending.disposition).toBe('unresolved');
  });
});

describe('complete evidence accounting — no silent omission across a full session', () => {
  it('every note is represented in items, excluded, or as a coverage-gap candidate', () => {
    const active = [
      { claim_id: 'c-1-1', note_sequence: 1, section_id: FB, disposition: 'navigation_context', status: 'active', raw_fragment: 'Moving into the front bedroom.' },
      { claim_id: 'c-2-1', note_sequence: 2, section_id: FB, element: 'party wall', disposition: 'active_evidence', status: 'active', raw_fragment: 'Party wall plastered.' },
    ];
    const notes = [
      { sequence: 1, raw_note: 'Moving into the front bedroom.', structured_response: { type: null } },
      { sequence: 2, raw_note: 'Party wall plastered.', structured_response: { type: null } },
      { sequence: 3, raw_note: 'How many rooms so far?', structured_response: { type: 'direct_answer', text: 'One room.' } },
    ];
    const canonicalInput = { sections, claims: { active, superseded: [] } };
    const items = buildDeterministicItems(canonicalInput);
    const excluded = classifyExcludedMaterial(notes);

    const accountedSequences = new Set([...items.map(i => i.source_note_sequence), ...excluded.map(e => e.note_sequence)]);
    for (const note of notes) {
      expect(accountedSequences.has(note.sequence)).toBe(true);
    }
  });
});
