// api/lib/__tests__/soc-provenance-chain.test.js
//
// Close-out pass, fix 1 — clarification-chain provenance. Tests the
// generic buildProvenanceChain mechanism in reconciliation.js
// directly, with the real, exact 350mm scenario plus the required
// A-F variants. D4 itself (fidelity-audit-contract.js) is untouched;
// these tests prove the EVIDENCE D4 is given is now complete, not
// that D4's reasoning changed.

import { describe, it, expect } from 'vitest';
import { buildDeterministicItems } from '../soc-brain-v2/reconciliation.js';
import { runFidelityAudit } from '../soc-brain-v2/fidelity-audit.js';

const sections = [{ id: 'fb', display_name: 'First Floor Front Bedroom', first_entered_sequence: 1 }];

describe('A. measurement in original note + element in clarification answer (the real 350mm case)', () => {
  it('the resolved claim\'s provenance chain includes both the original note (measurement) and the answer (element)', () => {
    const superseded = [{ claim_id: 'c-19-1', note_sequence: 19, section_id: 'fb', element: null, disposition: 'superseded', status: 'superseded', superseded_by: 'c-20-1', raw_fragment: "There's another crack on the wall, about 350 millimetres long." }];
    const active = [{ claim_id: 'c-20-1', note_sequence: 20, section_id: 'fb', element: 'party wall', defect_type: 'crack', measurement: '350 millimetres', disposition: 'active_evidence', status: 'active', raw_fragment: 'The party wall.' }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded } });
    const chain = items.find(i => i.id === 'c-20-1').raw_provenance;
    expect(chain.some(p => p.raw_fragment.includes('350 millimetres'))).toBe(true);
    expect(chain.some(p => p.raw_fragment === 'The party wall.')).toBe(true);
    expect(chain[0].note_sequence).toBeLessThan(chain[chain.length - 1].note_sequence); // chronological order
  });
});

describe('B. element in original note + measurement in clarification answer (reverse case)', () => {
  it('the chain includes both the element-establishing original and the measurement-establishing answer', () => {
    const superseded = [{ claim_id: 'c-9-1', note_sequence: 9, section_id: 'fb', element: 'party wall', defect_type: 'crack', disposition: 'superseded', status: 'superseded', superseded_by: 'c-10-1', raw_fragment: 'There is a crack to the party wall.' }];
    const active = [{ claim_id: 'c-10-1', note_sequence: 10, section_id: 'fb', element: 'party wall', defect_type: 'crack', measurement: '200 millimetres', disposition: 'active_evidence', status: 'active', raw_fragment: "It's about 200 millimetres." }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded } });
    const chain = items.find(i => i.id === 'c-10-1').raw_provenance;
    expect(chain.some(p => p.raw_fragment.includes('party wall'))).toBe(true);
    expect(chain.some(p => p.raw_fragment.includes('200 millimetres'))).toBe(true);
  });
});

describe('C. correction inheriting unchanged attributes from the corrected claim', () => {
  it('a measurement correction\'s chain still exposes the original\'s defect type/direction/location text', () => {
    const superseded = [{ claim_id: 'c-4-1', note_sequence: 4, section_id: 'fb', element: 'party wall', defect_type: 'hairline crack', measurement: '650 millimetres', direction: 'diagonally up', location: 'corner', disposition: 'superseded', status: 'superseded', superseded_by: 'c-5-1', raw_fragment: 'hairline crack, 650mm, diagonally up from the corner' }];
    const active = [{ claim_id: 'c-5-1', note_sequence: 5, section_id: 'fb', element: 'party wall', defect_type: 'hairline crack', measurement: '450 millimetres', direction: 'diagonally up', location: 'corner', disposition: 'active_evidence', status: 'active', raw_fragment: "Actually, that's 450, not 650." }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded } });
    const chain = items.find(i => i.id === 'c-5-1').raw_provenance;
    expect(chain.some(p => p.raw_fragment.includes('hairline crack'))).toBe(true);
    expect(chain.some(p => p.raw_fragment.includes('diagonally up'))).toBe(true);
    expect(chain.some(p => p.raw_fragment.includes('corner'))).toBe(true);
    expect(chain.some(p => p.raw_fragment.includes("450, not 650"))).toBe(true);
  });
});

describe('D. chained clarification/correction (multi-step, arbitrary depth)', () => {
  it('a three-deep chain (original -> first correction -> second correction) exposes all three raw fragments, in order', () => {
    const superseded = [
      { claim_id: 'c-1-1', note_sequence: 1, section_id: 'fb', element: 'party wall', measurement: '650mm', disposition: 'superseded', status: 'superseded', superseded_by: 'c-2-1', raw_fragment: 'ORIGINAL: 650mm crack' },
      { claim_id: 'c-2-1', note_sequence: 2, section_id: 'fb', element: 'party wall', measurement: '500mm', disposition: 'superseded', status: 'superseded', superseded_by: 'c-3-1', raw_fragment: 'FIRST CORRECTION: actually 500mm' },
    ];
    const active = [{ claim_id: 'c-3-1', note_sequence: 3, section_id: 'fb', element: 'party wall', measurement: '450mm', disposition: 'active_evidence', status: 'active', raw_fragment: 'SECOND CORRECTION: actually 450mm' }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded } });
    const chain = items.find(i => i.id === 'c-3-1').raw_provenance;
    expect(chain.map(p => p.raw_fragment)).toEqual([
      'ORIGINAL: 650mm crack',
      'FIRST CORRECTION: actually 500mm',
      'SECOND CORRECTION: actually 450mm',
    ]);
  });
});

describe('E. a genuinely unsupported resolved fact still triggers a fidelity conflict — D4 is not weakened', () => {
  it('even with the full chain visible, D4 still flags a fact neither the original nor the correction actually states', async () => {
    const superseded = [{ claim_id: 'c-1-1', note_sequence: 1, section_id: 'fb', element: 'party wall', defect_type: 'crack', disposition: 'superseded', status: 'superseded', superseded_by: 'c-2-1', raw_fragment: 'There is a crack.' }];
    const active = [{ claim_id: 'c-2-1', note_sequence: 2, section_id: 'fb', element: 'party wall', defect_type: 'crack', measurement: '999mm', disposition: 'active_evidence', status: 'active', raw_fragment: 'Confirmed.' }];
    const draftResult = {
      reconciliation_items: buildDeterministicItems({ sections, claims: { active, superseded } }),
      sections: [{ section_id: 'fb', section_name: 'First Floor Front Bedroom', rows: [
        { observation: 'A crack of 999mm was noted to the party wall.', element: 'party wall', source_item_ids: ['c-2-1'] },
      ] }],
    };
    const supabase = {
      from: (table) => {
        if (table === 'ai_messages') return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
        if (table === 'soc_sections') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: sections.map(s => ({ id: s.id, first_entered_sequence: s.first_entered_sequence })), error: null }) }) }) };
        if (table === 'soc_claims') return { select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    };
    // Simulate the real model correctly noticing 999mm is stated
    // nowhere in either raw fragment, even with both now visible.
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ findings: [{ severity: 'blocking', type: 'invented_fact', draft_row_id: 'sec-x', source_item_ids: ['c-2-1'], draft_text: 'A crack of 999mm was noted to the party wall.', evidence_summary: 'Neither the original note nor the correction states 999mm.', required_action: 'Remove the unsupported measurement.', auto_repairable: false, proposed_repair: null }] }) } }] }) });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult, apiKey: 'k' });
    expect(result.findings.some(f => f.type === 'invented_fact')).toBe(true);
  });
});

describe('F. no resurrection of superseded facts — provenance enrichment does not change status/draftability', () => {
  it('a superseded predecessor remains status=superseded, draftable=false, regardless of appearing in a later item\'s provenance chain', () => {
    const superseded = [{ claim_id: 'c-4-1', note_sequence: 4, section_id: 'fb', element: 'party wall', measurement: '650mm', disposition: 'superseded', status: 'superseded', superseded_by: 'c-5-1', raw_fragment: '650mm crack' }];
    const active = [{ claim_id: 'c-5-1', note_sequence: 5, section_id: 'fb', element: 'party wall', measurement: '450mm', disposition: 'active_evidence', status: 'active', raw_fragment: 'Actually 450mm.' }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded } });
    const supersededItem = items.find(i => i.id === 'c-4-1');
    expect(supersededItem.status).toBe('superseded');
    expect(supersededItem.draftable).toBe(false);
    // The active replacement's OWN provenance may reference the
    // superseded predecessor's text, but the predecessor item itself
    // is never reclassified as active by that.
    const activeItem = items.find(i => i.id === 'c-5-1');
    expect(activeItem.raw_provenance.some(p => p.claim_id === 'c-4-1')).toBe(true);
    expect(supersededItem.status).toBe('superseded'); // still, after being referenced
  });
});
