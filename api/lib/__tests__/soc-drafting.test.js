// api/lib/__tests__/soc-drafting.test.js
//
// Phase D3 — regression tests for the professional drafting layer.
// Mocks reconcile() (D2, already tested independently) so these
// focus purely on drafting's own responsibilities: which items reach
// the model, section isolation, provenance validation, and User Brain
// composition.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../soc-brain-v2/reconciliation.js', () => ({
  reconcile: vi.fn(),
}));

import { reconcile } from '../soc-brain-v2/reconciliation.js';
import { draft } from '../soc-brain-v2/drafting.js';
import { DRAFTING_CONTRACT } from '../soc-brain-v2/drafting-contract.js';

function mockReconciliationResult({ sections, items, excluded = [] }) {
  reconcile.mockResolvedValue({ session_id: 's1', sections, items, excluded });
}

function mockModelResponse(rowsBySection) {
  let call = 0;
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const userMsg = body.messages[1].content;
    const sectionName = /SECTION: (.+)/.exec(userMsg)?.[1];
    const rows = rowsBySection[sectionName] || [];
    call++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows }) } }] }) };
  };
  return () => call;
}

const FB = { id: 'sec-front', display_name: 'First Floor Front Bedroom', first_entered_sequence: 1 };
const RB = { id: 'sec-rear', display_name: 'First Floor Rear Bedroom', first_entered_sequence: 6 };

describe('draft() — only draftable items reach the model', () => {
  it('excludes superseded, navigation_context, and unresolved items from what is shown to the model', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [
        { id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'party wall, plaster finish', disposition: 'active_evidence', draftable: true },
        { id: 'c-2', section_id: FB.id, element: 'party wall', resolved_content: '650mm crack (superseded)', disposition: 'superseded', draftable: false },
        { id: 'c-3', section_id: FB.id, element: null, resolved_content: 'Moving into the room', disposition: 'navigation_context', draftable: false },
        { id: 'c-4', section_id: FB.id, element: null, resolved_content: 'ambiguous crack', disposition: 'unresolved', draftable: false },
      ],
    });
    let capturedPrompt = '';
    global.fetch = async (url, opts) => {
      capturedPrompt = JSON.parse(opts.body).messages[1].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [{ observation: 'x', element: 'party wall', source_item_ids: ['c-1'] }] }) } }] }) };
    };
    await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(capturedPrompt).toContain('c-1');
    expect(capturedPrompt).not.toContain('650mm crack (superseded)');
    expect(capturedPrompt).not.toContain('Moving into the room');
    expect(capturedPrompt).not.toContain('ambiguous crack');
  });
});

describe('draft() — section integrity enforced by construction', () => {
  it('calls the model once per section, each call seeing only that section\'s items', async () => {
    mockReconciliationResult({
      sections: [FB, RB],
      items: [
        { id: 'fb-1', section_id: FB.id, element: 'party wall', resolved_content: 'front bedroom fact', disposition: 'active_evidence', draftable: true },
        { id: 'rb-1', section_id: RB.id, element: 'party wall', resolved_content: 'rear bedroom fact', disposition: 'active_evidence', draftable: true },
      ],
    });
    const prompts = [];
    global.fetch = async (url, opts) => {
      prompts.push(JSON.parse(opts.body).messages[1].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [] }) } }] }) };
    };
    await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(prompts.length).toBe(2);
    expect(prompts[0]).toContain('front bedroom fact');
    expect(prompts[0]).not.toContain('rear bedroom fact');
    expect(prompts[1]).toContain('rear bedroom fact');
    expect(prompts[1]).not.toContain('front bedroom fact');
  });

  it('produces sections in first-visit order, unchanged from D2/D1', async () => {
    mockReconciliationResult({ sections: [FB, RB], items: [] });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"rows":[]}' } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(result.sections.map(s => s.section_id)).toEqual([FB.id, RB.id]);
  });
});

describe('draft() — provenance validated by code, not trusted from the model', () => {
  it('strips a source_item_id the model hallucinated that was never offered to it', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [{ id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'x', disposition: 'active_evidence', draftable: true }],
    });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [{ observation: 'y', element: 'party wall', source_item_ids: ['c-1', 'c-99-never-offered'] }] }) } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(result.sections[0].rows[0].source_item_ids).toEqual(['c-1']);
  });

  it('does not strip a cross-section id from a legitimately combined multi-item row', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [
        { id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'a', disposition: 'active_evidence', draftable: true },
        { id: 'c-2', section_id: FB.id, element: 'party wall', resolved_content: 'b', disposition: 'active_evidence', draftable: true },
      ],
    });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [{ observation: 'combined', element: 'party wall', source_item_ids: ['c-1', 'c-2'] }] }) } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(result.sections[0].rows[0].source_item_ids).toEqual(['c-1', 'c-2']);
  });
});

describe('draft() — recovered raw evidence (D2) is available to drafting like any other draftable item', () => {
  it('a recovered item (source: raw_recovery) reaches the model the same as a state item', async () => {
    mockReconciliationResult({
      sections: [RB],
      items: [{ id: 'recovered-7-1', source: 'raw_recovery', section_id: RB.id, element: 'wall abutting the front bedroom', resolved_content: 'No visible defects were observed.', disposition: 'active_evidence', draftable: true, recovered: true }],
    });
    let capturedPrompt = '';
    global.fetch = async (url, opts) => {
      capturedPrompt = JSON.parse(opts.body).messages[1].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"rows":[]}' } }] }) };
    };
    await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(capturedPrompt).toContain('No visible defects were observed.');
  });
});

describe('draft() — conversational material never reaches drafting', () => {
  it('excluded items (direct questions, assistant responses) are not part of any section\'s draftable items', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [{ id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'x', disposition: 'active_evidence', draftable: true }],
      excluded: [{ note_sequence: 15, raw_fragment: 'How many rooms so far?', reason: 'direct_question' }],
    });
    let capturedPrompt = '';
    global.fetch = async (url, opts) => {
      capturedPrompt = JSON.parse(opts.body).messages[1].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"rows":[]}' } }] }) };
    };
    await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(capturedPrompt).not.toContain('How many rooms');
  });
});

describe('draft() — model/configuration', () => {
  it('uses gpt-5.6-terra with its established invocation pattern (developer role, max_completion_tokens, no forced response_format)', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [{ id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'x', disposition: 'active_evidence', draftable: true }],
    });
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"rows":[]}' } }] }) };
    };
    await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(capturedBody.model).toBe('gpt-5.6-terra');
    expect(capturedBody.messages[0].role).toBe('developer');
    expect(capturedBody.max_completion_tokens).toBeDefined();
    expect(capturedBody.response_format).toBeUndefined();
  });

  it('falls back to gpt-4o if Terra fails', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [{ id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'x', disposition: 'active_evidence', draftable: true }],
    });
    const models = [];
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      models.push(body.model);
      if (body.model === 'gpt-5.6-terra') return { ok: false, status: 500 };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"rows":[]}' } }] }) };
    };
    await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(models).toEqual(['gpt-5.6-terra', 'gpt-4o']);
  });
});

describe('draft() — User Brain integration', () => {
  it('includes stated style preferences in the system content sent to the model when set', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [{ id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'x', disposition: 'active_evidence', draftable: true }],
    });
    let capturedSystem = '';
    global.fetch = async (url, opts) => {
      capturedSystem = JSON.parse(opts.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"rows":[]}' } }] }) };
    };
    await draft({}, { sessionId: 's1', apiKey: 'k', userBrain: { soc_style_preferences: 'Prefer short, direct sentences.' } });
    expect(capturedSystem).toContain('Prefer short, direct sentences.');
  });

  it('falls back to the governing User Brain text alone when no per-user preferences exist', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [{ id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'x', disposition: 'active_evidence', draftable: true }],
    });
    let capturedSystem = '';
    global.fetch = async (url, opts) => {
      capturedSystem = JSON.parse(opts.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"rows":[]}' } }] }) };
    };
    await draft({}, { sessionId: 's1', apiKey: 'k' }); // no userBrain
    expect(capturedSystem).toContain('Nora User SOC Brain');
  });
});

describe('draft() — output schema / parse robustness', () => {
  it('strips markdown code fences before parsing the model response', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [{ id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'x', disposition: 'active_evidence', draftable: true }],
    });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"rows":[{"observation":"y","element":"party wall","source_item_ids":["c-1"]}]}\n```' } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(result.sections[0].rows[0].observation).toBe('y');
  });

  it('a section with zero draftable items produces an empty rows array without calling the model', async () => {
    mockReconciliationResult({ sections: [FB], items: [] });
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(called).toBe(false);
    expect(result.sections[0].rows).toEqual([]);
  });
});

// D3 acceptance correction (2026-09-19): a live run combined two
// genuinely distinct Front Bedroom party-wall observations (cracking
// resolved from an STT correction, and a separately clarified ~200mm
// crack) into one ambiguous sentence that read as though a single
// measurement belonged to a single fact. Fixed as a general drafting
// principle (SAFE SYNTHESIS, drafting-contract.js), not a rule about
// this specific wording/measurement/element. What's actually testable
// here without a live model: the contract itself states the
// principle correctly, and the code-level provenance handling
// correctly supports every scenario the principle depends on —
// combined rows retaining every source id, separate rows each
// retaining their own, regardless of how the model chooses to
// combine or separate.
describe('DRAFTING_CONTRACT — safe synthesis principle (D3 acceptance correction)', () => {
  it('states that combining must preserve identity, quantity, and material relationships', () => {
    expect(DRAFTING_CONTRACT).toContain('identity, quantity, and material relationships');
  });

  it('names the specific ambiguities combining must not introduce', () => {
    expect(DRAFTING_CONTRACT).toContain('whether there are one or two (or more) distinct things being described');
    expect(DRAFTING_CONTRACT).toContain('which measurement belongs to which thing');
  });

  it('requires separate rows when a clear combined sentence is not achievable', () => {
    expect(DRAFTING_CONTRACT).toContain('draft separate rows instead');
  });

  it('frames this as a case-by-case judgment, not a fixed combine/never-combine rule', () => {
    expect(DRAFTING_CONTRACT).toContain('not a fixed rule about which items may or may not ever be combined');
  });

  it('does not hard-code the specific fixture wording, measurement, element, or room that motivated this correction', () => {
    expect(DRAFTING_CONTRACT.toLowerCase()).not.toContain('bugatti');
    expect(DRAFTING_CONTRACT).not.toContain('200mm');
    expect(DRAFTING_CONTRACT).not.toContain('200 millimetres');
    expect(DRAFTING_CONTRACT.toLowerCase()).not.toContain('rear bedroom');
    expect(DRAFTING_CONTRACT.toLowerCase()).not.toContain('front bedroom');
  });
});

describe('draft() — safe-synthesis provenance scenarios (code-level guarantees)', () => {
  it('two separate cracks on the same wall, drafted as separate rows, each retain only their own source id', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [
        { id: 'crack-a', section_id: FB.id, element: 'party wall', resolved_content: 'party wall, crack, 300mm', disposition: 'active_evidence', draftable: true },
        { id: 'crack-b', section_id: FB.id, element: 'party wall', resolved_content: 'party wall, crack, 150mm', disposition: 'active_evidence', draftable: true },
      ],
    });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [
      { observation: 'A crack of 300mm was noted.', element: 'party wall', source_item_ids: ['crack-a'] },
      { observation: 'A separate crack of 150mm was noted.', element: 'party wall', source_item_ids: ['crack-b'] },
    ] }) } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(result.sections[0].rows.length).toBe(2);
    expect(result.sections[0].rows[0].source_item_ids).toEqual(['crack-a']);
    expect(result.sections[0].rows[1].source_item_ids).toEqual(['crack-b']);
  });

  it('one crack with a measurement and another without, combined into one row, retain both ids even though only one carries a measurement', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [
        { id: 'crack-measured', section_id: FB.id, element: 'party wall', resolved_content: 'party wall, crack, 200mm', disposition: 'active_evidence', draftable: true },
        { id: 'crack-unmeasured', section_id: FB.id, element: 'party wall', resolved_content: 'party wall, cracking', disposition: 'active_evidence', draftable: true },
      ],
    });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [
      { observation: 'Cracking was noted to the party wall, together with a separate crack measuring approximately 200mm.', element: 'party wall', source_item_ids: ['crack-measured', 'crack-unmeasured'] },
    ] }) } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(result.sections[0].rows[0].source_item_ids.sort()).toEqual(['crack-measured', 'crack-unmeasured']);
  });

  it('staining spatially related to a crack, legitimately combined, retains both source ids', async () => {
    mockReconciliationResult({
      sections: [RB],
      items: [
        { id: 'crack-1', section_id: RB.id, element: 'party wall', resolved_content: 'party wall, crack, 300mm, vertical', disposition: 'active_evidence', draftable: true },
        { id: 'staining-1', section_id: RB.id, element: 'party wall', resolved_content: 'party wall, staining, just above the crack', disposition: 'active_evidence', draftable: true },
      ],
    });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [
      { observation: 'A vertical crack of 300mm was noted, with staining immediately above it.', element: 'party wall', source_item_ids: ['crack-1', 'staining-1'] },
    ] }) } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(result.sections[0].rows[0].source_item_ids.sort()).toEqual(['crack-1', 'staining-1']);
  });

  it('two observations sharing an element but otherwise independent do not lose either id when combined', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [
        { id: 'finish-1', section_id: FB.id, element: 'party wall', resolved_content: 'party wall, plaster and emulsion finish', disposition: 'active_evidence', draftable: true },
        { id: 'defect-1', section_id: FB.id, element: 'party wall', resolved_content: 'party wall, crack, 100mm', disposition: 'active_evidence', draftable: true },
      ],
    });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [
      { observation: 'The party wall has a plaster and emulsion finish. A crack of 100mm was separately noted.', element: 'party wall', source_item_ids: ['finish-1', 'defect-1'] },
    ] }) } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(result.sections[0].rows[0].source_item_ids.sort()).toEqual(['defect-1', 'finish-1']);
  });

  it('a row that would incorrectly transfer a measurement between two items still preserves both ids in provenance, so a later audit can catch a real misattribution against the source evidence', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [
        { id: 'measured', section_id: FB.id, element: 'party wall', resolved_content: 'party wall, crack, 200mm', disposition: 'active_evidence', draftable: true },
        { id: 'unmeasured', section_id: FB.id, element: 'party wall', resolved_content: 'party wall, cracking', disposition: 'active_evidence', draftable: true },
      ],
    });
    // Even a poorly-drafted, ambiguous sentence keeps both ids in
    // provenance - the code's job is retaining traceability, not
    // judging prose quality (that's this contract's job, and later,
    // Fidelity Audit's).
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [
      { observation: 'Cracking of 200mm was noted to the party wall.', element: 'party wall', source_item_ids: ['measured', 'unmeasured'] },
    ] }) } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(result.sections[0].rows[0].source_item_ids).toContain('measured');
    expect(result.sections[0].rows[0].source_item_ids).toContain('unmeasured');
  });

  it('an evidence item never disappears merely because another item on the same element was drafted', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [
        { id: 'item-a', section_id: FB.id, element: 'party wall', resolved_content: 'a', disposition: 'active_evidence', draftable: true },
        { id: 'item-b', section_id: FB.id, element: 'party wall', resolved_content: 'b', disposition: 'active_evidence', draftable: true },
        { id: 'item-c', section_id: FB.id, element: 'party wall', resolved_content: 'c', disposition: 'active_evidence', draftable: true },
      ],
    });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [
      { observation: 'x', element: 'party wall', source_item_ids: ['item-a', 'item-b'] },
      { observation: 'y', element: 'party wall', source_item_ids: ['item-c'] },
    ] }) } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    const allIds = result.sections[0].rows.flatMap(r => r.source_item_ids);
    expect(allIds.sort()).toEqual(['item-a', 'item-b', 'item-c']);
  });
});

// D5 acceptance boundary (2026-09-19): stable row identity, generated
// once here at creation, never based on array position.
describe('draft() — stable row_id generation', () => {
  it('every row gets a row_id, independent of citation order in source_item_ids', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [
        { id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'a', disposition: 'active_evidence', draftable: true },
        { id: 'c-2', section_id: FB.id, element: 'party wall', resolved_content: 'b', disposition: 'active_evidence', draftable: true },
      ],
    });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [
      { observation: 'combined', element: 'party wall', source_item_ids: ['c-2', 'c-1'] },
    ] }) } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    expect(result.sections[0].rows[0].row_id).toMatch(/^row-/);
    // Provenance (source_item_ids) is the separate, authoritative
    // record of what a row is drawn from — row_id identifies the row
    // itself and is not derived from citation order or content.
    expect(result.sections[0].rows[0].source_item_ids.sort()).toEqual(['c-1', 'c-2']);
  });

  it('two different rows in the same section get different, unique row_ids', async () => {
    mockReconciliationResult({
      sections: [FB],
      items: [
        { id: 'c-1', section_id: FB.id, element: 'party wall', resolved_content: 'a', disposition: 'active_evidence', draftable: true },
        { id: 'c-2', section_id: FB.id, element: 'party wall', resolved_content: 'b', disposition: 'active_evidence', draftable: true },
      ],
    });
    global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ rows: [
      { observation: 'x', element: 'party wall', source_item_ids: ['c-1'] },
      { observation: 'y', element: 'party wall', source_item_ids: ['c-2'] },
    ] }) } }] }) });
    const result = await draft({}, { sessionId: 's1', apiKey: 'k' });
    const ids = result.sections[0].rows.map(r => r.row_id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every(id => /^row-/.test(id))).toBe(true);
  });
});
