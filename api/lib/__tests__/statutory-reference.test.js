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
