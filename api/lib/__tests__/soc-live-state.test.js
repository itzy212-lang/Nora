// api/lib/__tests__/soc-live-state.test.js
//
// Phase C — unit tests for live-state.js, the code-enforced persistence
// layer beneath the live semantic processor. These test the actual
// production functions directly, against a mocked Supabase client, so
// they exercise the real logic (section reuse vs creation,
// first-visit-order preservation, claim shaping) without needing a live
// database connection or a real model call.
//
// What these tests deliberately do NOT cover: whether the model itself
// correctly reasons about a room return, a contextual pronoun, or an STT
// error — that's genuine semantic judgment, not something a unit test
// can meaningfully assert. These tests assume a plausible model output
// for each scenario (the kind the Live Processing Contract asks for) and
// verify the code applies it correctly and safely.

import { describe, it, expect, vi } from 'vitest';
import { normaliseSectionKey, buildSectionIndexText, resolveSection, applyLiveProcessingResult } from '../soc-brain-v2/live-state.js';

function makeMockSupabase({ existingSection = null, insertedSection = null, rpcResult = { ok: true, claims_inserted: 1, claims_superseded: 0 }, rpcError = null } = {}) {
  const calls = { updates: [], inserts: [], rpc: [] };
  const sectionsTable = {
    select: () => sectionsTable,
    eq: () => sectionsTable,
    maybeSingle: async () => ({ data: existingSection }),
    update: (payload) => { calls.updates.push(payload); return sectionsTable; },
    insert: (payload) => { calls.inserts.push(payload); return sectionsTable; },
    single: async () => insertedSection ? { data: insertedSection, error: null } : { data: null, error: new Error('insert failed') },
  };
  return {
    from: (table) => {
      if (table === 'soc_sections') return sectionsTable;
      return sectionsTable; // not exercised by these tests beyond soc_sections
    },
    rpc: async (name, params) => {
      calls.rpc.push({ name, params });
      return rpcError ? { data: null, error: rpcError } : { data: rpcResult, error: null };
    },
    _calls: calls,
  };
}

describe('normaliseSectionKey', () => {
  it('lowercases and underscore-separates a display name', () => {
    expect(normaliseSectionKey('Rear Bedroom')).toBe('rear_bedroom');
    expect(normaliseSectionKey('First Floor Front Elevation Room')).toBe('first_floor_front_elevation_room');
  });

  it('strips punctuation and collapses repeated separators', () => {
    expect(normaliseSectionKey('Ground Floor - Rear/Extension')).toBe('ground_floor_rear_extension');
  });

  it('handles empty/undefined input safely', () => {
    expect(normaliseSectionKey('')).toBe('');
    expect(normaliseSectionKey(undefined)).toBe('');
  });
});

describe('buildSectionIndexText', () => {
  it('reports no sections established for a fresh inspection', () => {
    expect(buildSectionIndexText([], null)).toContain('first note of the inspection');
  });

  it('lists every section and marks the currently active one', () => {
    const sections = [
      { id: 'a', section_key: 'front_bedroom', display_name: 'Front Bedroom', floor_level: 'First Floor' },
      { id: 'b', section_key: 'rear_bedroom', display_name: 'Rear Bedroom', floor_level: 'First Floor' },
    ];
    const text = buildSectionIndexText(sections, 'b');
    expect(text).toContain('key="front_bedroom"');
    expect(text).toContain('key="rear_bedroom"');
    expect(text).toMatch(/rear_bedroom.*CURRENTLY ACTIVE/);
    expect(text).not.toMatch(/front_bedroom.*CURRENTLY ACTIVE/);
  });
});

describe('resolveSection — Scenario 1: entering a room (genuine first entry)', () => {
  it('creates a new section with first_entered_sequence set to the current note', async () => {
    const supabase = makeMockSupabase({
      existingSection: null,
      insertedSection: { id: 'sec-1', display_name: 'Front Bedroom' },
    });
    const result = await resolveSection(supabase, {
      sessionId: 's1', projectId: 'p1', aoId: 'ao1', sequence: 1,
      resolution: { action: 'create_new', section_key: 'front_bedroom', display_name: 'Front Bedroom', floor_level: 'First Floor' },
    });
    expect(result.created).toBe(true);
    expect(result.section_id).toBe('sec-1');
    expect(supabase._calls.inserts[0].first_entered_sequence).toBe(1);
    expect(supabase._calls.inserts[0].last_active_sequence).toBe(1);
  });
});

describe('resolveSection — Scenario 4: returning to an earlier room', () => {
  it('reuses the existing section and does NOT touch first_entered_sequence', async () => {
    const supabase = makeMockSupabase({
      existingSection: { id: 'sec-1', display_name: 'Front Bedroom', first_entered_sequence: 1 },
    });
    const result = await resolveSection(supabase, {
      sessionId: 's1', projectId: 'p1', aoId: 'ao1', sequence: 8,
      resolution: { action: 'reuse_existing', section_key: 'front_bedroom', display_name: 'Front Bedroom' },
    });
    expect(result.created).toBe(false);
    expect(result.section_id).toBe('sec-1');
    // Scenario 5: first-visit order must survive reactivation — the
    // update call must only ever touch last_active_sequence/updated_at,
    // never first_entered_sequence, for a reused section.
    const updatePayload = supabase._calls.updates[0];
    expect(updatePayload).toHaveProperty('last_active_sequence', 8);
    expect(updatePayload).not.toHaveProperty('first_entered_sequence');
  });
});

describe('resolveSection — Scenario 3: referring to another room without moving', () => {
  it('returns null (no section change) for action "same_as_current"', async () => {
    const supabase = makeMockSupabase();
    const result = await resolveSection(supabase, {
      sessionId: 's1', projectId: 'p1', aoId: 'ao1', sequence: 5,
      resolution: { action: 'same_as_current' },
    });
    expect(result).toBeNull();
    expect(supabase._calls.inserts.length).toBe(0);
    expect(supabase._calls.updates.length).toBe(0);
  });
});

describe('applyLiveProcessingResult — Scenario 6/8: correction preserving unaffected facts', () => {
  it('builds an amendment claim with only the corrected field populated, passes correct_measurement to the RPC', async () => {
    const supabase = makeMockSupabase({
      existingSection: { id: 'sec-1', display_name: 'Front Bedroom' },
    });
    const modelOutput = {
      section_resolution: { action: 'same_as_current' },
      claims: [{
        claim_type: 'amendment',
        element: 'party wall',
        measurement: 'approximately 450mm',
        amendment_mode: 'correct_measurement',
        raw_fragment: 'actually, that crack is 450mm, not 650mm',
        confidence: 'high',
      }],
      resolves_pending_clarification: false,
      live_response: { required: false, type: null, text: null },
    };
    await applyLiveProcessingResult(supabase, {
      sessionId: 's1', noteId: 'note-5', sequence: 5, projectId: 'p1', aoId: 'ao1', modelOutput,
    });
    const rpcCall = supabase._calls.rpc[0];
    expect(rpcCall.name).toBe('process_soc_note_atomic');
    expect(rpcCall.params.p_correction_mode).toBe('correct_measurement');
    expect(rpcCall.params.p_note_type).toBe('amendment');
    const sentClaims = JSON.parse(rpcCall.params.p_claims);
    expect(sentClaims[0].measurement).toBe('approximately 450mm');
    // Unaffected fields were never stated by the model and correctly
    // stay null on this claim — the RPC's own supersession logic (not
    // this layer) is what preserves the OLD claim's other attributes by
    // leaving them untouched on the superseded row.
    expect(sentClaims[0].direction).toBeNull();
  });
});

describe('applyLiveProcessingResult — Scenario 7: "actually" as an additional observation', () => {
  it('sends a plain, non-amendment claim when the model does not set amendment_mode', async () => {
    const supabase = makeMockSupabase({ existingSection: { id: 'sec-1', display_name: 'Front Bedroom' } });
    const modelOutput = {
      section_resolution: { action: 'same_as_current' },
      claims: [{
        claim_type: 'specific_defect',
        element: 'party wall',
        defect_type: 'hairline crack',
        location: '300mm above the first crack',
        raw_fragment: 'actually, there is another crack about 300mm above that one',
        confidence: 'high',
      }],
      resolves_pending_clarification: false,
      live_response: { required: false, type: null, text: null },
    };
    await applyLiveProcessingResult(supabase, {
      sessionId: 's1', noteId: 'note-6', sequence: 6, projectId: 'p1', aoId: 'ao1', modelOutput,
    });
    const rpcCall = supabase._calls.rpc[0];
    expect(rpcCall.params.p_correction_mode).toBeNull();
    expect(rpcCall.params.p_note_type).toBe('observation');
  });
});

describe('applyLiveProcessingResult — Scenario 15: duplicate/repeated dictation', () => {
  it('routes an "excluded" claim_type through unchanged — disposition mapping to duplicate happens in the RPC, not this layer', async () => {
    const supabase = makeMockSupabase({ existingSection: { id: 'sec-1', display_name: 'Front Bedroom' } });
    const modelOutput = {
      section_resolution: { action: 'same_as_current' },
      claims: [{ claim_type: 'excluded', raw_fragment: 'same crack already recorded', confidence: 'high' }],
      resolves_pending_clarification: false,
      live_response: { required: false, type: null, text: null },
    };
    await applyLiveProcessingResult(supabase, {
      sessionId: 's1', noteId: 'note-10', sequence: 10, projectId: 'p1', aoId: 'ao1', modelOutput,
    });
    const sentClaims = JSON.parse(supabase._calls.rpc[0].params.p_claims);
    expect(sentClaims[0].claim_type).toBe('excluded');
  });
});

describe('applyLiveProcessingResult — Scenario 17: processing failure surfaces, is not swallowed', () => {
  it('throws when the RPC returns an error, rather than returning a false success', async () => {
    const supabase = makeMockSupabase({
      existingSection: { id: 'sec-1', display_name: 'Front Bedroom' },
      rpcError: { message: 'SEQUENCE_ERROR: received note 3 but last persisted sequence is 5.' },
    });
    const modelOutput = {
      section_resolution: { action: 'same_as_current' },
      claims: [{ claim_type: 'general_condition', raw_fragment: 'no visible defects', confidence: 'high' }],
      resolves_pending_clarification: false,
      live_response: { required: false, type: null, text: null },
    };
    await expect(applyLiveProcessingResult(supabase, {
      sessionId: 's1', noteId: 'note-3', sequence: 3, projectId: 'p1', aoId: 'ao1', modelOutput,
    })).rejects.toThrow(/SEQUENCE_ERROR/);
  });
});

describe('applyLiveProcessingResult — claim id generation', () => {
  it('generates stable, ordered claim_ids from the note sequence, matching the RPC/checklist convention', async () => {
    const supabase = makeMockSupabase({ existingSection: { id: 'sec-1', display_name: 'Kitchen' } });
    const modelOutput = {
      section_resolution: { action: 'same_as_current' },
      claims: [
        { claim_type: 'construction_description', raw_fragment: 'a', confidence: 'high' },
        { claim_type: 'general_condition', raw_fragment: 'b', confidence: 'high' },
      ],
      resolves_pending_clarification: false,
      live_response: { required: false, type: null, text: null },
    };
    await applyLiveProcessingResult(supabase, {
      sessionId: 's1', noteId: 'note-4', sequence: 4, projectId: 'p1', aoId: 'ao1', modelOutput,
    });
    const sentClaims = JSON.parse(supabase._calls.rpc[0].params.p_claims);
    expect(sentClaims[0].claim_id).toBe('c-4-1');
    expect(sentClaims[1].claim_id).toBe('c-4-2');
  });
});
