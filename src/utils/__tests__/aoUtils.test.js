import { describe, it, expect } from 'vitest';
import { sortAOsNumerically } from '../aoUtils';

describe('sortAOsNumerically', () => {
  it('sorts AO records by leading street number in the address, not the owner name', () => {
    // Regression for the 6-7 month "random order" complaint: the field
    // fallback chain used to check `name` before `address`, and AO
    // records almost always have a `name` set (the owner), so the
    // number was being read from the wrong field (or not found at all).
    const aos = [
      { name: 'Mr Smith', address: '12 High Street' },
      { name: 'Mrs Jones', address: '2 High Street' },
      { name: 'Mr Patel', address: '101 High Street' },
    ];
    const sorted = sortAOsNumerically(aos);
    expect(sorted.map(a => a.address)).toEqual([
      '2 High Street',
      '12 High Street',
      '101 High Street',
    ]);
  });

  it('does not get fooled by a name that happens to start with a digit', () => {
    const aos = [
      { name: '99 Problems Ltd', address: '5 Church Road' },
      { name: 'Mr Owner', address: '30 Church Road' },
    ];
    const sorted = sortAOsNumerically(aos);
    expect(sorted.map(a => a.address)).toEqual([
      '5 Church Road',
      '30 Church Road',
    ]);
  });

  it('falls back through address-like fields when the primary one is missing, never using name', () => {
    const aos = [
      { name: 'Owner A', premise: '20 Mill Lane' },
      { name: 'Owner B', ao_address: '4 Mill Lane' },
      { name: 'Owner C', service_address: '15 Mill Lane' },
    ];
    const sorted = sortAOsNumerically(aos);
    expect(sorted.map(a => a.premise || a.ao_address || a.service_address)).toEqual([
      '4 Mill Lane',
      '15 Mill Lane',
      '20 Mill Lane',
    ]);
  });

  it('respects a custom addressField and still ignores name', () => {
    const list = [
      { name: 'Owner A', customAddr: '8 Park View' },
      { name: 'Owner B', customAddr: '1 Park View' },
    ];
    const sorted = sortAOsNumerically(list, 'customAddr');
    expect(sorted.map(a => a.customAddr)).toEqual(['1 Park View', '8 Park View']);
  });

  it('sorts entries with no leading number to the end, not the start', () => {
    const aos = [
      { name: 'Owner A', address: 'Flat 2, Riverside Court' },
      { name: 'Owner B', address: '3 Riverside Court' },
    ];
    const sorted = sortAOsNumerically(aos);
    expect(sorted.map(a => a.address)).toEqual([
      '3 Riverside Court',
      'Flat 2, Riverside Court',
    ]);
  });

  it('returns non-array input unchanged', () => {
    expect(sortAOsNumerically(null)).toBe(null);
    expect(sortAOsNumerically(undefined)).toBe(undefined);
  });
});
