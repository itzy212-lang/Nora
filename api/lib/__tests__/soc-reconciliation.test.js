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
import { buildDeterministicItems, classifyExcludedMaterial, findCoverageGaps, isDraftable } from '../soc-brain-v2/reconciliation.js';

const FB = 'sec-front';
const RB = 'sec-rear';
const sections = [
  { id: FB, display_name: 'First Floor Front Bedroom', first_entered_sequence: 1 },
  { id: RB, display_name: 'First Floor Rear Bedroom', first_entered_sequence: 6 },
];

describe('isDraftable — the deterministic, code-enforced rule', () => {
  it('only active_evidence and site_general_note are draftable', () => {
    expect(isDraftable('active_evidence')).toBe(true);
    expect(isDraftable('site_general_note')).toBe(true);
    expect(isDraftable('superseded')).toBe(false);
    expect(isDraftable('duplicate')).toBe(false);
    expect(isDraftable('navigation_context')).toBe(false);
    expect(isDraftable('unresolved')).toBe(false);
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

describe('findCoverageGaps — raw-detail recovery candidate detection', () => {
  it('detects "no visible defects" as uncovered when only "also plastered" was extracted as a claim', () => {
    const claims = { active: [{ claim_id: 'c-7-1', note_sequence: 7, section_id: RB, element: 'wall abutting the front bedroom', disposition: 'active_evidence', status: 'active', raw_fragment: 'The wall abutting the front bedroom is also plastered' }], superseded: [] };
    const notes = [{ sequence: 7, raw_note: 'The wall abutting the front bedroom is also plastered, no visible defects.', structured_response: { type: null } }];
    const gaps = findCoverageGaps({ sections, claims }, notes);
    expect(gaps.some(g => g.clause.toLowerCase().includes('no visible defects'))).toBe(true);
  });

  it('does not flag a note whose text is fully covered by its claim', () => {
    const claims = { active: [{ claim_id: 'c-3-1', note_sequence: 3, section_id: FB, element: 'window', disposition: 'active_evidence', status: 'active', raw_fragment: 'The window opened and closed satisfactorily no sticking or binding' }], superseded: [] };
    const notes = [{ sequence: 3, raw_note: 'The window opened and closed satisfactorily no sticking or binding', structured_response: { type: null } }];
    const gaps = findCoverageGaps({ sections, claims }, notes);
    expect(gaps.length).toBe(0);
  });

  it('skips a direct-question note entirely — nothing to recover from conversational material', () => {
    const claims = { active: [], superseded: [] };
    const notes = [{ sequence: 15, raw_note: 'How many rooms have I recorded so far?', structured_response: { type: 'direct_answer' } }];
    expect(findCoverageGaps({ sections, claims }, notes)).toEqual([]);
  });

  it('skips a note with zero claims — not this stage\'s concern (it has no state to compare against)', () => {
    const claims = { active: [], superseded: [] };
    const notes = [{ sequence: 99, raw_note: 'Some note with no extracted claims at all.', structured_response: { type: null } }];
    expect(findCoverageGaps({ sections, claims }, notes)).toEqual([]);
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
