import { describe, it, expect } from 'vitest';
import { pickReferenceRefs, formatStatutoryReference, loadStatutoryReference, MAX_REFS, MAX_CHARS } from '../statutory-reference.js';

describe('pickReferenceRefs', () => {
  it('returns nothing for an ordinary email request', () => {
    expect(pickReferenceRefs('Reply to say Monday at 10am works for the access visit')).toEqual([]);
  });
  it('picks notice sections for notice expiry', () => {
    const r = pickReferenceRefs('Does the notice expire after a year?');
    expect(r).toContain('s3');
  });
  it('picks fees sections', () => {
    expect(pickReferenceRefs('Who pays the surveyor fees?')).toEqual(expect.arrayContaining(['s11', 'fpws_faq_fees']));
  });
  it('honours explicit section numbers', () => {
    expect(pickReferenceRefs('what does section 6 say')).toContain('s6');
  });
  it('is capped and deduplicated', () => {
    const r = pickReferenceRefs('dispute award appeal fees section 3 section 6 excavation compensation');
    expect(r.length).toBeLessThanOrEqual(MAX_REFS);
    expect(new Set(r).size).toBe(r.length);
  });
  it('does not pull definitions just because owners are mentioned', () => {
    const r = pickReferenceRefs('The adjoining owner is refusing to pay their share');
    expect(r).not.toContain('s20');
  });
  it('picks notice sections for consent', () => {
    expect(pickReferenceRefs('The AO has given consent')).toContain('s3');
  });
  it('handles empty input', () => {
    expect(pickReferenceRefs('')).toEqual([]);
    expect(pickReferenceRefs(null)).toEqual([]);
  });
});

describe('formatStatutoryReference', () => {
  it('returns null for no rows', () => expect(formatStatutoryReference([])).toBeNull());
  it('labels and caps size', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ title: `T${i}`, statutory_text: 'x'.repeat(2000), practice_notes: '' }));
    const out = formatStatutoryReference(rows);
    expect(out).toMatch(/STATUTORY AND FACULTY REFERENCE/);
    expect(out.length).toBeLessThan(MAX_CHARS + 600);
  });
});

describe('loadStatutoryReference', () => {
  it('returns null without a client or on error', async () => {
    expect(await loadStatutoryReference(null, 'notice')).toBeNull();
    const bad = { from: () => ({ select: () => ({ in: async () => ({ error: new Error('x') }) }) }) };
    expect(await loadStatutoryReference(bad, 'notice expiry')).toBeNull();
  });
  it('does not query for an unrelated request', async () => {
    let called = false;
    const sb = { from: () => { called = true; return {}; } };
    expect(await loadStatutoryReference(sb, 'thanks, see you then')).toBeNull();
    expect(called).toBe(false);
  });
});

import { formatFullAct, sectionNumber } from '../statutory-reference.js';

describe('full Act', () => {
  const rows = [
    { section_ref: 's10', title: 'Section 10', statutory_text: 'Disputes text' },
    { section_ref: 's2', title: 'Section 2', statutory_text: 'Rights text' },
    { section_ref: 'fpws_faq_fees', title: 'FAQ', statutory_text: 'faq' },
  ];
  it('orders numerically and excludes non-Act rows', () => {
    const out = formatFullAct(rows);
    expect(out.indexOf('Section 2')).toBeLessThan(out.indexOf('Section 10'));
    expect(out).not.toMatch(/FAQ/);
    expect(out).toMatch(/Sections held: 2, 10/);
  });
  it('tells the model not to assert what is outside the stored sections', () => {
    expect(formatFullAct(rows)).toMatch(/do not state what they say/);
  });
  it('labels the stored text as condensed, not verbatim', () => {
    expect(formatFullAct(rows)).toMatch(/condensed working copy/);
    expect(formatFullAct(rows)).toMatch(/not present its wording as a verbatim/);
  });
  it('returns null with no Act rows', () => expect(formatFullAct([])).toBeNull());
  it('sectionNumber only matches Act sections', () => {
    expect(sectionNumber('s6')).toBe(6);
    expect(sectionNumber('fpws_faq_fees')).toBeNull();
  });
});
