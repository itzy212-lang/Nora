// api/lib/__tests__/soc-generation-boundary.test.js
//
// Phase D1 — regression tests for the generation barrier
// (generation-barrier.js) and the canonical, read-only generation
// input (generation-input.js).
//
// Confirmed in the D0 audit, and demonstrated live during this
// implementation (the accepted acceptance session's soc_claims were
// found wiped to zero rows moments after the acceptance audit
// completed — a real-world instance of the exact bug this phase
// fixes, caused by the still-live old code before this deploy): the
// previous generation path deleted soc_claims and rebuilt it from
// raw text via a parallel, per-note, context-free extraction on every
// single Generate click. These tests exist specifically to make that
// class of defect structurally impossible to reintroduce unnoticed:
// they assert the assembly functions never call delete/update/insert
// on the inspection tables at all - read-only is a property the tests
// check directly, not just a design intention.

import { describe, it, expect } from 'vitest';
import { checkGenerationBarrier } from '../soc-brain-v2/generation-barrier.js';
import { assembleCanonicalGenerationInput } from '../soc-brain-v2/generation-input.js';

function makeMockSupabase({ notes = [], sessionMetadata = {}, transcript = [], sections = [], claims = [] } = {}) {
  const calls = { mutations: [] };
  function track(kind, table) { calls.mutations.push({ kind, table }); }

  const tables = {
    soc_notes: {
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: notes, error: null }) }) }),
    },
    ai_sessions: {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { metadata: sessionMetadata }, error: null }) }) }),
    },
    ai_messages: {
      select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: transcript, error: null }) }) }) }),
    },
    soc_sections: {
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: sections, error: null }) }) }),
      // Any mutation attempt on this table must be visible to the test -
      // deliberately has no delete/update/insert implementation, so
      // calling one would throw "is not a function", failing the test
      // loudly rather than silently mutating anything.
    },
    soc_claims: {
      select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: claims, error: null }) }) }) }),
    },
  };

  return {
    from: (table) => {
      if (!tables[table]) throw new Error(`Unexpected table access: ${table}`);
      return tables[table];
    },
    _calls: calls,
    _track: track,
  };
}

describe('checkGenerationBarrier', () => {
  it('passes clear when every note processed successfully and no clarification is pending', async () => {
    const supabase = makeMockSupabase({
      notes: [{ id: 'n1', sequence: 1, processing_status: 'processed' }, { id: 'n2', sequence: 2, processing_status: 'clarification_required' }],
      sessionMetadata: { pending_clarification: null },
    });
    const result = await checkGenerationBarrier(supabase, 's1');
    expect(result.ok).toBe(true);
  });

  it('blocks when a note is still actively processing', async () => {
    const supabase = makeMockSupabase({
      notes: [{ id: 'n1', sequence: 1, processing_status: 'processing' }],
      sessionMetadata: {},
    });
    const result = await checkGenerationBarrier(supabase, 's1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('notes_still_processing');
    expect(result.blocking_notes.length).toBe(1);
  });

  it('blocks when a note failed processing', async () => {
    const supabase = makeMockSupabase({
      notes: [{ id: 'n1', sequence: 1, processing_status: 'failed' }],
      sessionMetadata: {},
    });
    const result = await checkGenerationBarrier(supabase, 's1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('notes_failed_processing');
  });

  it('blocks when a live clarification is still unanswered, even though every note has processing_status processed', async () => {
    // Mirrors the real fixture's own historical shape: a note that once
    // raised a clarification keeps processing_status: 'clarification_required'
    // forever as a per-note historical record, even after being answered -
    // that must NOT block generation on its own. Only a genuinely still-open
    // pending_clarification in session metadata should.
    const supabase = makeMockSupabase({
      notes: [{ id: 'n13', sequence: 13, processing_status: 'clarification_required' }],
      sessionMetadata: { pending_clarification: { question: 'Which wall?', clarification_id: 'clar-13' } },
    });
    const result = await checkGenerationBarrier(supabase, 's1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('pending_clarification_unanswered');
    expect(result.pending_clarification.question).toBe('Which wall?');
  });

  it('does NOT block on a resolved historical clarification_required note once pending_clarification is cleared', async () => {
    // The exact real-fixture shape after resolution: note 13 keeps its
    // historical status, but metadata.pending_clarification is null.
    const supabase = makeMockSupabase({
      notes: [
        { id: 'n13', sequence: 13, processing_status: 'clarification_required' },
        { id: 'n14', sequence: 14, processing_status: 'processed' },
      ],
      sessionMetadata: { pending_clarification: null },
    });
    const result = await checkGenerationBarrier(supabase, 's1');
    expect(result.ok).toBe(true);
  });
});

describe('assembleCanonicalGenerationInput', () => {
  it('never calls delete, update, or insert on any table — read-only, structurally not just by convention', async () => {
    const supabase = makeMockSupabase({});
    // The mock's table objects only implement select/eq/order/limit — no
    // delete/update/insert methods exist at all. If the function under
    // test called any of them, this would throw "is not a function"
    // rather than silently succeeding, which is exactly the point.
    await expect(assembleCanonicalGenerationInput(supabase, { sessionId: 's1' })).resolves.toBeDefined();
  });

  it('separates active and superseded claims correctly', async () => {
    const claims = [
      { claim_id: 'c-4-1', status: 'superseded', superseded_by: 'c-5-1', measurement: '650 millimetres' },
      { claim_id: 'c-5-1', status: 'active', measurement: '450 millimetres' },
    ];
    const supabase = makeMockSupabase({ claims });
    const input = await assembleCanonicalGenerationInput(supabase, { sessionId: 's1' });
    expect(input.claims.active.map(c => c.claim_id)).toEqual(['c-5-1']);
    expect(input.claims.superseded.map(c => c.claim_id)).toEqual(['c-4-1']);
  });

  it('the superseded 650mm claim remains superseded, not active, and points at its actual replacement', async () => {
    const claims = [
      { claim_id: 'c-4-1', status: 'superseded', superseded_by: 'c-5-1', measurement: '650 millimetres', element: 'party wall' },
      { claim_id: 'c-5-1', status: 'active', measurement: '450 millimetres', element: 'party wall' },
    ];
    const supabase = makeMockSupabase({ claims });
    const input = await assembleCanonicalGenerationInput(supabase, { sessionId: 's1' });
    const superseded650 = input.claims.superseded.find(c => c.claim_id === 'c-4-1');
    expect(superseded650.measurement).toBe('650 millimetres');
    expect(superseded650.superseded_by_claim.claim_id).toBe('c-5-1');
    expect(superseded650.superseded_by_claim.measurement).toBe('450 millimetres');
    // Confirm 650mm never appears in the active set at all.
    expect(input.claims.active.some(c => c.measurement === '650 millimetres')).toBe(false);
  });

  it('sections are returned in first-visit order with stable ids', async () => {
    const sections = [
      { id: 'sec-front', section_key: 'first_floor_front_bedroom', display_name: 'First Floor Front Bedroom', first_entered_sequence: 1, last_active_sequence: 11 },
      { id: 'sec-rear', section_key: 'first_floor_rear_bedroom', display_name: 'First Floor Rear Bedroom', first_entered_sequence: 6, last_active_sequence: 6 },
    ];
    const supabase = makeMockSupabase({ sections });
    const input = await assembleCanonicalGenerationInput(supabase, { sessionId: 's1' });
    expect(input.sections.map(s => s.id)).toEqual(['sec-front', 'sec-rear']);
    expect(input.sections[0].first_entered_sequence).toBe(1);
    expect(input.sections[1].first_entered_sequence).toBe(6);
  });

  it('the raw transcript is included alongside the resolved state, unmodified', async () => {
    const transcript = [
      { id: 'm1', role: 'user', content: 'Moving into the first floor front bedroom.', created_at: '2026-09-19T07:52:17Z' },
      { id: 'm2', role: 'user', content: "Actually, that's 450, not 650.", created_at: '2026-09-19T07:53:09Z' },
    ];
    const supabase = makeMockSupabase({ transcript });
    const input = await assembleCanonicalGenerationInput(supabase, { sessionId: 's1' });
    expect(input.raw_transcript.length).toBe(2);
    expect(input.raw_transcript[1].content).toBe("Actually, that's 450, not 650.");
  });
});
