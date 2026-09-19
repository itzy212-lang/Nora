// api/lib/__tests__/soc-site-note-routing.test.js
//
// Final integration phase — dedicated tests for the site/general-note
// routing fix. The fix: site_general_note is real, final-SOC-bound
// evidence but was previously treated as draftable in the same sense
// as room evidence, so it flowed into per-section room drafting
// purely because some room was active when it was dictated. Fixed
// upstream of D3 (reconciliation.js's isDraftable/isSiteNote), not by
// changing D4's severity for wrong_section — D4 remains an
// independent defence layer, tested separately below (H).

import { describe, it, expect } from 'vitest';
import { buildDeterministicItems } from '../soc-brain-v2/reconciliation.js';
import { runFidelityAudit } from '../soc-brain-v2/fidelity-audit.js';

const FB = 'sec-front';
const RB = 'sec-rear';
const sections = [
  { id: FB, display_name: 'Front Room', first_entered_sequence: 1 },
  { id: RB, display_name: 'Rear Room', first_entered_sequence: 6 },
];

describe('A. a normal room observation remains room-draftable', () => {
  it('active_evidence items are draftable and not site notes', () => {
    const active = [{ claim_id: 'c-1', note_sequence: 1, section_id: FB, element: 'party wall', disposition: 'active_evidence', status: 'active', raw_fragment: 'x' }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded: [] } });
    expect(items[0].draftable).toBe(true);
    expect(items[0].is_site_note).toBe(false);
  });
});

describe('B. a site/general note is excluded from room drafting', () => {
  it('site_general_note items are not draftable', () => {
    const active = [{ claim_id: 'c-27', note_sequence: 27, section_id: RB, element: null, disposition: 'site_general_note', status: 'active', raw_fragment: 'Garden access note.' }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded: [] } });
    expect(items[0].draftable).toBe(false);
    expect(items[0].is_site_note).toBe(true);
  });
});

describe('C. a site/general note dictated while a room is active is still excluded from that room', () => {
  it('a site note tagged with an active room\'s section_id is still non-draftable and never enters that room\'s drafting pool', () => {
    const active = [
      { claim_id: 'c-room', note_sequence: 1, section_id: RB, element: 'party wall', disposition: 'active_evidence', status: 'active', raw_fragment: 'x' },
      { claim_id: 'c-27', note_sequence: 27, section_id: RB, element: null, disposition: 'site_general_note', status: 'active', raw_fragment: 'Garden access note.' },
    ];
    const items = buildDeterministicItems({ sections, claims: { active, superseded: [] } });
    const draftableInRB = items.filter(i => i.section_id === RB && i.draftable);
    expect(draftableInRB.map(i => i.id)).toEqual(['c-room']); // the site note, same section, is not among them
  });
});

describe('D/G. site note carries full provenance', () => {
  it('a site-note item exposes its raw_provenance and item id intact', () => {
    const active = [{ claim_id: 'c-27', note_sequence: 27, section_id: RB, element: null, disposition: 'site_general_note', status: 'active', raw_fragment: 'The building owner will require access through the garden of the adjoining owner.' }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded: [] } });
    const siteNote = items.find(i => i.is_site_note);
    expect(siteNote.id).toBe('c-27');
    expect(siteNote.raw_provenance[0].raw_fragment).toBe('The building owner will require access through the garden of the adjoining owner.');
    expect(siteNote.source_note_sequence).toBe(27);
  });
});

describe('E. site note does not create another room', () => {
  it('a site note carries an existing section_id, never introducing a new one; sections array is unaffected by claim content', () => {
    const active = [{ claim_id: 'c-27', note_sequence: 27, section_id: RB, element: null, disposition: 'site_general_note', status: 'active', raw_fragment: 'x' }];
    const items = buildDeterministicItems({ sections, claims: { active, superseded: [] } });
    expect(sections.map(s => s.id)).toContain(items[0].section_id);
    expect(sections.length).toBe(2);
  });
});

describe('F. site note does not alter section ordering', () => {
  it('sections list itself is untouched by the presence of a site note among the claims', () => {
    const active = [{ claim_id: 'c-27', note_sequence: 27, section_id: RB, element: null, disposition: 'site_general_note', status: 'active', raw_fragment: 'x' }];
    buildDeterministicItems({ sections, claims: { active, superseded: [] } });
    expect(sections.map(s => s.id)).toEqual([FB, RB]);
  });
});

describe('H. D4 remains capable of detecting a wrong-section site note as a defence layer', () => {
  it('a site note item forced (simulating an upstream defect) into a drafted row under the wrong section is still caught by the existing, unchanged checkSectionAssignment logic', async () => {
    const draftResult = {
      reconciliation_items: [
        { id: 'c-27', section_id: RB, section_name: 'Rear Room', disposition: 'site_general_note', status: 'active', draftable: false, resolved_content: 'Garden access note.', raw_provenance: [{ raw_fragment: 'x' }] },
      ],
      sections: [
        { section_id: FB, section_name: 'Front Room', rows: [
          // Simulated defect: a site note item, whose own section_id is
          // RB, incorrectly appears drafted under FB.
          { observation: 'Garden access note.', element: 'site note', source_item_ids: ['c-27'] },
        ] },
      ],
    };
    const supabase = {
      from: (table) => {
        if (table === 'ai_messages') return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
        if (table === 'soc_sections') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: sections.map(s => ({ id: s.id, first_entered_sequence: s.first_entered_sequence })), error: null }) }) }) };
        if (table === 'soc_claims') return { select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    };
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"findings":[]}' } }] }) });
    const result = await runFidelityAudit(supabase, { sessionId: 's1', draftResult, apiKey: 'k' });
    expect(result.findings.some(f => f.type === 'wrong_section' && f.source_item_ids.includes('c-27'))).toBe(true);
  });
});
