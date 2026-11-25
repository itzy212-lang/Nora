import { describe, it, expect, vi } from 'vitest';

vi.mock('../../supabaseClient', () => ({ default: {} }));

import { tidyPersonName, displayOwnerName, serviceAddressDiffers, registerToFormPatch } from '../readLandRegistry';

const reg = {
  property_address: '18 Harcourt Road, London (N22 7XW)',
  owners: [
    { name: 'JOHN ALAN SMITH', kind: 'person', address_for_service: '4 Elm Close, Leeds LS1 1AA' },
    { name: 'MARY JANE SMITH', kind: 'person', address_for_service: '' },
    { name: 'THIRD OWNER', kind: 'person', address_for_service: '' },
  ],
};

describe('names', () => {
  it('title-cases capital-letter names, leaves mixed case and companies alone', () => {
    expect(tidyPersonName('JOHN ALAN SMITH')).toBe('John Alan Smith');
    expect(tidyPersonName("MARY O'BRIEN-JONES")).toBe("Mary O'Brien-Jones");
    expect(tidyPersonName('Anne McDonald')).toBe('Anne McDonald');
    expect(displayOwnerName({ name: 'ACME HOMES LIMITED', kind: 'company' })).toBe('ACME HOMES LIMITED');
  });
});

describe('service address', () => {
  it('differs when the owner lives elsewhere, not when it is the property', () => {
    expect(serviceAddressDiffers(reg)).toBe(true);
    expect(serviceAddressDiffers({ property_address: '18 Harcourt Road, London N22 7XW', owners: [{ name: 'A', address_for_service: '18 Harcourt Road, London (N22 7XW)' }] })).toBe(false);
    expect(serviceAddressDiffers({ property_address: 'x', owners: [{ name: 'A' }] })).toBe(false);
  });
});

describe('registerToFormPatch', () => {
  it('fills building owner fields from the first two owners and reports the rest', () => {
    const p = registerToFormPatch(reg, 'bo');
    expect(p.boPremise).toBe('18 Harcourt Road, London (N22 7XW)');
    expect(p.bo1Name).toBe('John Alan Smith');
    expect(p.bo2Name).toBe('Mary Jane Smith');
    expect(p.boService).toBe('');
    expect(p.extraOwners).toBe(1);
  });
  it('uses the address for service only when the user ticked it, and targets adjoining owner fields for ao', () => {
    const p = registerToFormPatch(reg, 'ao', { useServiceAddress: true });
    expect(p.aoPremise).toBe('18 Harcourt Road, London (N22 7XW)');
    expect(p.aoService).toBe('4 Elm Close, Leeds LS1 1AA');
    expect(p.useService).toBe(true);
    expect(p.bo1Name).toBeUndefined();
  });
});
