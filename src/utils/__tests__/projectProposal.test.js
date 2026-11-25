import { describe, it, expect } from 'vitest';
import { proposalToForm, proposalProblems, roleLabel } from '../projectProposal';

const bo = {
  role: 'BO',
  property_address: '18 Harcourt Road, London N22 7XW',
  service_address: '',
  owners: [{ name: 'John Alan Smith', email: 'john@example.com', phone: '' }, { name: 'Mary Jane Smith' }],
  works: 'Loft conversion',
};

describe('proposalToForm', () => {
  it('puts a building owner proposal on the building owner side of the form', () => {
    const { form, sameAddr } = proposalToForm(bo);
    expect(form.role).toBe('BO');
    expect(form.boPremise).toBe('18 Harcourt Road, London N22 7XW');
    expect(form.bo1.name).toBe('John Alan Smith');
    expect(form.bo1.email).toBe('john@example.com');
    expect(form.bo2.name).toBe('Mary Jane Smith');
    expect(form.aoPremise).toBe('');
    expect(form.works).toBe('Loft conversion');
    expect(sameAddr).toBe(true);
  });

  it('puts an adjoining owner proposal on the adjoining owner side, and keeps a separate service address', () => {
    const { form, sameAddr } = proposalToForm({ ...bo, role: 'AO', service_address: '4 Elm Close, Leeds' });
    expect(form.aoPremise).toBe('18 Harcourt Road, London N22 7XW');
    expect(form.ao1.name).toBe('John Alan Smith');
    expect(form.aoService).toBe('4 Elm Close, Leeds');
    expect(form.bo1.name).toBe('');
    expect(sameAddr).toBe(false);
  });
});

describe('proposalProblems', () => {
  it('is empty when everything needed is present', () => {
    expect(proposalProblems(bo)).toEqual([]);
  });
  it('lists exactly what is missing, in plain words', () => {
    expect(proposalProblems({ role: '', property_address: '', owners: [] })).toHaveLength(3);
    expect(proposalProblems({ ...bo, role: '' })).toEqual(["Which side you're acting for (building owner's or adjoining owner's surveyor)"]);
    expect(proposalProblems({ ...bo, owners: [] })).toEqual(["The owner's full name"]);
  });
  it('labels roles', () => {
    expect(roleLabel('BO')).toBe("Building owner's surveyor");
    expect(roleLabel('')).toBe('');
  });
});
