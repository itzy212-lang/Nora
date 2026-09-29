import { describe, it, expect } from 'vitest';
import { getAOs, projectDisplay, sortProjectsByAddress, aoAddress } from '../Calendar.jsx';

// Regression coverage for the "Add task" flow's Project (building owner)
// and Adjoining owner dropdowns, reported 2026-09-29 as showing addresses
// in what looked like random order. Root cause was two related bugs:
//  1. The Project list was sorted by a digit pulled out of `ref` (an
//     internal code), not by the address actually shown in the option.
//  2. The AO list was sorted using aoUtils.js's generic field-priority
//     chain, which checks fields in a different order than aoAddress()
//     (the function that builds what's actually displayed) - so the sort
//     order and the displayed text could come from different fields.

describe('sortProjectsByAddress', () => {
  it('sorts projects by the street number of the address actually displayed, not by ref', () => {
    const projects = [
      { id: 'a', ref: '1', bo_premise_address: '284 Silverdale Rd, Earley, Reading, RG6 7NU' },
      { id: 'b', ref: '99', bo_premise_address: '41 Patrick Road, Reading, RG4 8DD' },
      { id: 'c', ref: '2', bo_premise_address: '16 Park Avenue, London, N3 2EJ' },
    ];
    const sorted = sortProjectsByAddress(projects);
    expect(sorted.map(p => p.id)).toEqual(['c', 'b', 'a']); // 16, 41, 284
  });

  it('sends non-numeric-leading addresses to the end rather than the top', () => {
    const projects = [
      { id: 'named', name: 'Braeside', bo_premise_address: 'Braeside, Catlins Lane, Pinner HA5 2EZ' },
      { id: 'numbered', bo_premise_address: '8 Biggin Avenue, Mitcham, CR4 3HN' },
    ];
    const sorted = sortProjectsByAddress(projects);
    expect(sorted.map(p => p.id)).toEqual(['numbered', 'named']);
  });

  it('is stable / non-mutating and handles an empty or missing list', () => {
    const projects = [{ id: 'x', bo_premise_address: '5 High St' }];
    const sorted = sortProjectsByAddress(projects);
    expect(projects).toHaveLength(1); // original array untouched
    expect(sorted).not.toBe(projects);
    expect(sortProjectsByAddress([])).toEqual([]);
    expect(sortProjectsByAddress(undefined)).toEqual([]);
  });
});

describe('getAOs (Adjoining Owner sort)', () => {
  it('sorts AOs by the street number of the address actually displayed (aoAddress), not a mismatched field', () => {
    // reg_addr and address deliberately disagree, to prove the sort uses
    // the same field aoAddress() would display, not aoUtils.js's default
    // priority (which would read `address` here, giving the wrong order).
    const project = {
      aos: [
        { id: '1', reg_addr: '50 Rokeby Gardens, Woodford Green, Essex, IG8 9HT', address: '999 Unrelated Rd' },
        { id: '2', reg_addr: '10 Rokeby Gardens, Woodford Green, Essex, IG8 9HT', address: '1 Unrelated Rd' },
      ],
    };
    const sorted = getAOs(project);
    // aoAddress() prefers premise, then reg_addr, then address - so it
    // reads reg_addr here (no premise set), and the sort must follow that
    // same field, not `address`.
    expect(sorted.map(ao => aoAddress(ao, project))).toEqual([
      '10 Rokeby Gardens, Woodford Green, Essex, IG8 9HT',
      '50 Rokeby Gardens, Woodford Green, Essex, IG8 9HT',
    ]);
  });

  it('falls back to project address when the AO itself has none, without crashing', () => {
    const project = { bo_premise_address: '7 Fallback Ave', aos: [{ id: '1' }] };
    expect(() => getAOs(project)).not.toThrow();
  });

  it('handles a project with no AOs', () => {
    expect(getAOs({})).toEqual([]);
    expect(getAOs({ aos: null })).toEqual([]);
  });
});

describe('projectDisplay', () => {
  it('prefers the building owner address over name/ref/id', () => {
    expect(projectDisplay({ bo_premise_address: '12 Example Rd', name: 'Smith', ref: 'REF-1' }))
      .toBe('12 Example Rd');
  });
});
