import { describe, it, expect } from 'vitest';
import { normaliseLandRegistry, parseModelJson, looksLikeRegisterText } from '../land-registry.js';

describe('normaliseLandRegistry', () => {
  it('keeps two owners exactly as returned, with their own addresses for service', () => {
    const r = normaliseLandRegistry({
      is_land_registry_register: true,
      title_number: 'NGL123456',
      tenure: 'Freehold',
      property_address: '18 Harcourt Road, London (N22 7XW)',
      owners: [
        { name: 'JOHN ALAN SMITH', kind: 'person', address_for_service: '18 Harcourt Road, London N22 7XW' },
        { name: 'MARY JANE SMITH', kind: 'person', address_for_service: '4 Elm Close, Leeds LS1 1AA' },
      ],
    });
    expect(r.owners).toHaveLength(2);
    expect(r.owners[1].address_for_service).toBe('4 Elm Close, Leeds LS1 1AA');
    expect(r.tenure).toBe('freehold');
    expect(r.title_number).toBe('NGL123456');
    expect(r.is_land_registry_register).toBe(true);
  });

  it('drops owners without a name and never invents missing fields', () => {
    const r = normaliseLandRegistry({ owners: [{ name: '  ' }, { name: 'ACME HOMES LIMITED', kind: 'company' }] });
    expect(r.owners).toEqual([{ name: 'ACME HOMES LIMITED', kind: 'company', company_number: '', address_for_service: '' }]);
    expect(r.title_number).toBe('');
    expect(r.property_address).toBe('');
  });

  it('is not a register when nothing useful was found', () => {
    expect(normaliseLandRegistry({ is_land_registry_register: false }).is_land_registry_register).toBe(false);
    expect(normaliseLandRegistry({}).is_land_registry_register).toBe(false);
  });

  it('survives model output wrapped in markdown or prose', () => {
    const r = normaliseLandRegistry('Here you go:\n```json\n{"title_number":"AB1","owners":[{"name":"X Y"}]}\n```');
    expect(r.title_number).toBe('AB1');
    expect(r.owners[0].name).toBe('X Y');
    expect(parseModelJson('not json')).toBeNull();
    expect(normaliseLandRegistry('not json')).toBeNull();
  });

  it('recognises register text', () => {
    expect(looksLikeRegisterText('OFFICIAL COPY OF REGISTER OF TITLE\nTitle number NGL1')).toBe(true);
    expect(looksLikeRegisterText('Dear Sir, thanks for your email')).toBe(false);
  });
});
