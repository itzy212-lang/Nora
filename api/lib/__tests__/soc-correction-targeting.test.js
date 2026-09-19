// api/lib/__tests__/soc-correction-targeting.test.js
//
// Regression tests for the correction/supersession redesign (2026-09-19,
// second round). The live acceptance test found that correcting one
// fact ("actually, that's 450, not 650") was superseding every active
// claim sharing the same element - including the party wall's entirely
// unrelated finish and condition claims - and that the resulting
// active correction carried only the changed field, losing the
// crack's unaffected attributes (hairline, diagonal, from the corner)
// from the active state entirely.
//
// Design: the schema already had what was needed - claim_id (a stable,
// unique identity RECENT CONTEXT already labels every claim with) and
// superseded_by (an existing, previously-unused column). No new column
// was required. The model now states corrects_claim_id explicitly -
// the exact prior claim_id its correction targets - and the RPC acts
// on that reference alone: supersede that one specific claim, and
// insert a new active claim that is the target's complete attribute
// set with only the model-supplied fields overridden. No heuristic
// matching (same element, latest claim, keyword matching) is used
// anywhere in this path.
//
// What these JS tests cover: that corrects_claim_id passes through
// this layer intact, and that a merged/corrected claim's resulting
// shape is retrievable by the existing recent-context mechanism. The
// actual merge-and-targeted-supersede logic lives entirely in
// PL/pgSQL (process_soc_note_atomic) and cannot be exercised by a JS
// mock — no real SQL runs against it. That logic was verified directly
// against the live database instead, with these exact results:
//
//   Setup: c-1-1/c-1-2 = party wall finish + condition (unrelated).
//          c-2-1 = party wall, hairline crack, 650mm, diagonal, from
//          the corner.
//   Note 3: amendment, measurement=450mm, corrects_claim_id=c-2-1.
//     -> c-1-1, c-1-2: unchanged, status=active (scenarios 4, 5)
//     -> c-2-1: status=superseded, superseded_by=c-3-1, all original
//        fields intact - hairline crack/650mm/diagonal/from the
//        corner (scenarios 1, 2)
//     -> c-3-1: status=active, element=party wall (inherited),
//        defect_type=hairline crack (inherited), direction=running
//        diagonally up (inherited), location=from the corner
//        (inherited), measurement=450 millimetres (the correction) -
//        exactly "party wall: hairline crack, ~450mm, running
//        diagonally up from the corner" (scenario 3)
//   Note 4: a second, unrelated crack, c-4-1, 200mm.
//   Note 5: amendment, measurement=400mm, corrects_claim_id=c-3-1.
//     -> c-4-1: untouched, still active, still 200mm (scenarios 6, 7)
//     -> c-3-1: now superseded, superseded_by=c-5-1 (chained
//        supersession correctly tracked: c-2-1 -> c-3-1 -> c-5-1)
//     -> c-5-1: active, 400mm
//   Note 6: amendment with corrects_claim_id pointing at a claim_id
//   that doesn't exist (simulating a stale/hallucinated reference).
//     -> inserted as its own standalone active claim, raw_fragment
//        preserved, nothing superseded, no error - the safe fallback
//        when a target can't be found (no target guessed as a
//        substitute).
//   All test data created and cleaned up in an isolated throwaway
//   session; production data untouched throughout.

import { describe, it, expect } from 'vitest';
import { applyLiveProcessingResult } from '../soc-brain-v2/live-state.js';
import { loadLiveContext, formatRecentClaim } from '../soc-brain-v2/live-processor.js';

function makeMockSupabase({ existingSection = null, rpcResult = { ok: true, claims_inserted: 1, claims_superseded: 1 } } = {}) {
  const calls = { rpc: [] };
  const sectionsTable = {
    select: () => sectionsTable,
    eq: () => sectionsTable,
    maybeSingle: async () => ({ data: existingSection }),
  };
  return {
    from: () => sectionsTable,
    rpc: async (name, params) => { calls.rpc.push({ name, params }); return { data: rpcResult, error: null }; },
    _calls: calls,
  };
}

describe('applyLiveProcessingResult — corrects_claim_id pass-through', () => {
  it('carries corrects_claim_id through to the RPC exactly as the model stated it', async () => {
    const supabase = makeMockSupabase({ existingSection: { id: 'sec-front', display_name: 'Front Bedroom' } });
    const modelOutput = {
      section_resolution: { action: 'same_as_current' },
      claims: [{ claim_type: 'amendment', measurement: '450 millimetres', amendment_mode: 'correct_measurement', corrects_claim_id: 'c-2-1', raw_fragment: "Actually, that's 450, not 650.", confidence: 'high' }],
      resolves_pending_clarification: false,
      live_response: { required: false, type: null, text: null },
    };
    await applyLiveProcessingResult(supabase, { sessionId: 's1', noteId: 'note-3', sequence: 3, projectId: 'p1', aoId: 'ao1', modelOutput });
    expect(supabase._calls.rpc[0].params.p_claims[0].corrects_claim_id).toBe('c-2-1');
  });

  it('stays null for an ordinary observation with no correction', async () => {
    const supabase = makeMockSupabase({ existingSection: { id: 'sec-front', display_name: 'Front Bedroom' } });
    const modelOutput = {
      section_resolution: { action: 'same_as_current' },
      claims: [{ claim_type: 'specific_defect', element: 'window', defect_type: 'crack', raw_fragment: 'a crack above the window', confidence: 'high' }],
      resolves_pending_clarification: false,
      live_response: { required: false, type: null, text: null },
    };
    await applyLiveProcessingResult(supabase, { sessionId: 's1', noteId: 'note-1', sequence: 1, projectId: 'p1', aoId: 'ao1', modelOutput });
    expect(supabase._calls.rpc[0].params.p_claims[0].corrects_claim_id).toBeNull();
  });

  it('[8] an additive "Actually..." statement carries no amendment_mode and no corrects_claim_id, so nothing can be superseded by it', async () => {
    const supabase = makeMockSupabase({ existingSection: { id: 'sec-rear', display_name: 'Rear Bedroom' } });
    const modelOutput = {
      section_resolution: { action: 'same_as_current' },
      claims: [{ claim_type: 'specific_defect', element: 'party wall', defect_type: 'crack', measurement: '200 millimetres', raw_fragment: 'another crack about 200 millimetres to the left of that one', confidence: 'high' }],
      resolves_pending_clarification: false,
      live_response: { required: false, type: null, text: null },
    };
    await applyLiveProcessingResult(supabase, { sessionId: 's1', noteId: 'note-10', sequence: 10, projectId: 'p1', aoId: 'ao1', modelOutput });
    const claim = supabase._calls.rpc[0].params.p_claims[0];
    expect(claim.amendment_mode).toBeNull();
    expect(claim.corrects_claim_id).toBeNull();
    expect(supabase._calls.rpc[0].params.p_correction_mode).toBeNull();
  });
});

describe('[9] the corrected, merged claim is available in recent context for the next live note', () => {
  it('formats a merged corrected claim with its inherited attributes, not a bare fragment', () => {
    // Shape a fully-merged claim would actually have once the RPC has
    // combined the target's attributes with the correction, matching
    // what was directly verified against the live database.
    const mergedClaim = {
      claim_id: 'c-3-1',
      element: 'party wall',
      defect_type: 'hairline crack',
      measurement: '450 millimetres',
      direction: 'running diagonally up',
      location: 'from the corner',
      raw_fragment: "Actually, that's 450, not 650.",
    };
    const line = formatRecentClaim(mergedClaim);
    expect(line).toContain('element="party wall"');
    expect(line).toContain('hairline crack');
    expect(line).toContain('450 millimetres');
    expect(line).toContain('running diagonally up');
    // The complete corrected observation, not a bare "party wall, 450mm"
    // fragment — this is exactly what makes it usable by the next note's
    // reasoning without needing to separately consult the superseded row.
  });

  it('a merged claim with the active section id is retrievable by loadLiveContext\'s existing query', async () => {
    const filters = { seen: null };
    const claimsQuery = (eqs) => ({
      eq: (col, val) => claimsQuery([...eqs, [col, val]]),
      order: () => claimsQuery(eqs),
      limit: () => {
        filters.seen = eqs;
        return Promise.resolve({
          data: [{ claim_id: 'c-3-1', element: 'party wall', defect_type: 'hairline crack', measurement: '450 millimetres', direction: 'running diagonally up', location: 'from the corner', raw_fragment: "Actually, that's 450, not 650." }],
        });
      },
    });
    const supabase = {
      from: (table) => table === 'soc_sections'
        ? { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ id: 'sec-front', section_key: 'front_bedroom', display_name: 'Front Bedroom', last_active_sequence: 3 }] }) }) }) }
        : { select: () => claimsQuery([]) },
    };
    const context = await loadLiveContext(supabase, { sessionId: 's1' });
    expect(context.recentNotes[0].claim_id).toBe('c-3-1');
    expect(context.recentNotes[0].measurement).toBe('450 millimetres');
    expect(filters.seen.some(([col, val]) => col === 'section_id' && val === 'sec-front')).toBe(true);
  });
});
