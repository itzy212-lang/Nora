// api/lib/__tests__/soc-site-note-wording.test.js
//
// Close-out pass, fix 2 — professional site-note wording. Routing
// (which items are site notes, and that they stay out of room
// drafting) is accepted, frozen architecture and is not retested
// here beyond a light regression check (D) — see
// soc-site-note-routing.test.js for the full routing suite. These
// tests are about draftSiteNotes() specifically: does it produce
// professional text, does it stay evidence-bound, and does it fail
// safely.

import { describe, it, expect } from 'vitest';
import { draftSiteNotes, SITE_NOTE_DRAFTING_CONTRACT } from '../soc-brain-v2/site-note-drafting.js';

describe('A/B. conversational framing removed, factual meaning preserved', () => {
  it('the real garden-access example is rewritten as intended, via the real model-calling path', async () => {
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ site_notes: [{ item_id: 'c-27-1', professional_text: 'The Building Owner will require access through the garden of the Adjoining Owner.' }] }) } }] }) });
    const items = [{ id: 'c-27-1', resolved_content: 'can I add a site note that the building owner will require access through the Garden of the adjoining owner' }];
    const result = await draftSiteNotes(items, { apiKey: 'k' });
    expect(result[0].professional_text).toBe('The Building Owner will require access through the garden of the Adjoining Owner.');
    expect(result[0].professional_text).not.toContain('can I add');
  });
});

describe('C. the contract explicitly forbids invented agreement/entitlement', () => {
  it('states the exact prohibited patterns from the specification', () => {
    expect(SITE_NOTE_DRAFTING_CONTRACT).toContain('infer or state a legal right, entitlement, or agreement');
    expect(SITE_NOTE_DRAFTING_CONTRACT).toContain('has agreed to provide access');
    expect(SITE_NOTE_DRAFTING_CONTRACT).toContain('is entitled to access');
    expect(SITE_NOTE_DRAFTING_CONTRACT).toContain('introduce a date, route, condition, or obligation not actually dictated');
  });
});

describe('E. multiple site notes remain distinct', () => {
  it('each item gets its own professional_text, matched by item_id, not positionally', async () => {
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ site_notes: [
      { item_id: 'c-27-1', professional_text: 'The Building Owner will require access through the garden.' },
      { item_id: 'c-30-1', professional_text: 'Scaffolding will be erected to the rear elevation.' },
    ] }) } }] }) });
    const items = [
      { id: 'c-27-1', resolved_content: 'raw note about garden access' },
      { id: 'c-30-1', resolved_content: 'raw note about scaffolding' },
    ];
    const result = await draftSiteNotes(items, { apiKey: 'k' });
    expect(result.find(r => r.id === 'c-27-1').professional_text).toContain('garden');
    expect(result.find(r => r.id === 'c-30-1').professional_text).toContain('Scaffolding');
  });
});

describe('F. details cannot be silently changed — safe fallback preserves the original fact verbatim', () => {
  it('falls back to the item\'s own resolved_content, unchanged, when no apiKey is available', async () => {
    const items = [{ id: 'c-27-1', resolved_content: 'Access required through the garden on 3 March, via the side gate.' }];
    const result = await draftSiteNotes(items, {});
    expect(result[0].professional_text).toBe('Access required through the garden on 3 March, via the side gate.');
  });

  it('falls back to the original fact, not a fabricated one, when the model call fails', async () => {
    global.fetch = async () => ({ ok: false, status: 500 });
    const items = [{ id: 'c-27-1', resolved_content: 'Access required through the garden on 3 March, via the side gate.' }];
    const result = await draftSiteNotes(items, { apiKey: 'k' });
    expect(result[0].professional_text).toBe('Access required through the garden on 3 March, via the side gate.');
  });

  it('an empty item list produces an empty result without calling the model', async () => {
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const result = await draftSiteNotes([], { apiKey: 'k' });
    expect(called).toBe(false);
    expect(result).toEqual([]);
  });
});

describe('D. site note remains outside room drafting (light regression check)', () => {
  it('draftSiteNotes never receives or returns anything resembling a section_id / room row shape', async () => {
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ site_notes: [{ item_id: 'c-27-1', professional_text: 'x' }] }) } }] }) });
    const items = [{ id: 'c-27-1', resolved_content: 'raw' }];
    const result = await draftSiteNotes(items, { apiKey: 'k' });
    expect(result[0]).not.toHaveProperty('section_id');
    expect(result[0]).not.toHaveProperty('element');
  });
});
