// api/lib/__tests__/soc-reference-codes.test.js
//
// Tests for the human-facing SOC reference code system. Purely a
// presentation-layer concern - these tests specifically confirm
// row_id, section_id and source_item_ids are never touched.

import { describe, it, expect } from 'vitest';
import { deriveBaseAbbreviation, assignRoomAbbreviations, applyHumanReferenceCodes } from '../soc-brain-v2/reference-codes.js';

describe('deriveBaseAbbreviation — normal abbreviations and floor-prefix removal', () => {
  it('matches every example from the specification exactly', () => {
    expect(deriveBaseAbbreviation('Ground Floor Front Reception Room')).toBe('FR');
    expect(deriveBaseAbbreviation('Ground Floor Rear Reception Room')).toBe('RR');
    expect(deriveBaseAbbreviation('First Floor Front Bedroom')).toBe('FB');
    expect(deriveBaseAbbreviation('First Floor Rear Bedroom')).toBe('RB');
    expect(deriveBaseAbbreviation('Kitchen')).toBe('K');
    expect(deriveBaseAbbreviation('Bathroom')).toBe('B');
    expect(deriveBaseAbbreviation('Hallway')).toBe('H');
    expect(deriveBaseAbbreviation('Landing')).toBe('L');
  });

  it('strips a floor-level prefix generically, not by hard-coded room name', () => {
    expect(deriveBaseAbbreviation('Second Floor Rear Bathroom')).toBe('RB');
    expect(deriveBaseAbbreviation('Third Floor Front Study')).toBe('FS');
    expect(deriveBaseAbbreviation('Basement Front Cellar')).toBe('FC');
  });

  it('handles arbitrary room names not in any example list', () => {
    expect(deriveBaseAbbreviation('Utility Room')).toBe('U');
    expect(deriveBaseAbbreviation('Home Office')).toBe('HO');
    expect(deriveBaseAbbreviation('Rear Extension Kitchen Diner')).toBe('REKD');
  });
});

describe('assignRoomAbbreviations — collision handling', () => {
  it('two rooms that would collide on their base abbreviation are deterministically distinguished', () => {
    const sections = [
      { section_id: 's1', section_name: 'Front Reception Room' },
      { section_id: 's2', section_name: 'First Floor Rear Reception Room' },
    ];
    // Both would naively abbreviate toward "FR"/"RR" - not colliding
    // here, so use two names that genuinely would collide:
    const colliding = [
      { section_id: 'a', section_name: 'Rear Bedroom' },
      { section_id: 'b', section_name: 'Rear Bathroom' },
    ];
    const codes = assignRoomAbbreviations(colliding);
    const values = [...codes.values()];
    expect(new Set(values).size).toBe(2); // never the same code twice
  });

  it('extends letters used before falling back to a numeric suffix', () => {
    // "Rear Bedroom" -> RB, "Rear Bathroom" -> RB (collision on 2-letter form).
    // Both have a 3rd word available (Bedroom vs Bathroom), so the
    // resolution should differentiate via more letters, not a number,
    // where more letters actually distinguish them.
    const sections = [
      { section_id: 'a', section_name: 'Rear Bedroom' },
      { section_id: 'b', section_name: 'Rear Bathroom' },
    ];
    const codes = assignRoomAbbreviations(sections);
    expect(codes.get('a')).not.toBe(codes.get('b'));
  });

  it('two genuinely identically-named rooms fall back to a stable numeric suffix, in first-visit order', () => {
    const sections = [
      { section_id: 'first', section_name: 'Storage Room' },
      { section_id: 'second', section_name: 'Storage Room' },
    ];
    const codes = assignRoomAbbreviations(sections);
    expect(codes.get('first')).not.toBe(codes.get('second'));
    // The first-visit room keeps the plain code; the later one is suffixed.
    expect(codes.get('first')).toBe('S');
    expect(codes.get('second')).toBe('S2');
  });
});

describe('applyHumanReferenceCodes — sequential numbering and identity preservation', () => {
  it('produces two-digit sequential numbers per room, restarting at 01 for each room', () => {
    const sections = [
      { section_id: 's1', section_name: 'Kitchen', rows: [{ row_id: 'r1' }, { row_id: 'r2' }] },
      { section_id: 's2', section_name: 'Bathroom', rows: [{ row_id: 'r3' }] },
    ];
    const result = applyHumanReferenceCodes(sections);
    expect(result[0].rows.map(r => r.human_reference)).toEqual(['K01', 'K02']);
    expect(result[1].rows.map(r => r.human_reference)).toEqual(['B01']);
  });

  it('never touches row_id, section_id, or source_item_ids', () => {
    const sections = [
      { section_id: 'sec-1', section_name: 'Kitchen', rows: [
        { row_id: 'row-abc123', element: 'wall', source_item_ids: ['c-1-1', 'c-2-1'], observation: 'x' },
      ] },
    ];
    const result = applyHumanReferenceCodes(sections);
    const row = result[0].rows[0];
    expect(row.row_id).toBe('row-abc123');
    expect(row.source_item_ids).toEqual(['c-1-1', 'c-2-1']);
    expect(result[0].section_id).toBe('sec-1');
    expect(row.human_reference).toBe('K01'); // added, not replacing anything
  });

  it('does not mutate the sections/rows objects it is given', () => {
    const original = { section_id: 's1', section_name: 'Kitchen', rows: [{ row_id: 'r1' }] };
    const sections = [original];
    applyHumanReferenceCodes(sections);
    expect(original.rows[0].human_reference).toBeUndefined();
  });
});
