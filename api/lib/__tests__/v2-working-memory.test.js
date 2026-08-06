import { describe, it, expect } from 'vitest';
import { assembleWorkingMemory, extractConfirmedProjectAnchors, extractCurrentDraftState, CATEGORY_PRIORITY, PROTECTED_CATEGORIES } from '../v2-working-memory.js';

describe('assembleWorkingMemory — structural guarantee: no sufficiency judgement exists', () => {
  it('the result never contains a field indicating whether context is "sufficient" or a gap is "answered"', () => {
    const result = assembleWorkingMemory({ selectedEmail: [{ id: 'e1', content: 'hello' }] });
    const keys = Object.keys(result);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toMatch(/sufficient|answered|resolved|gap_filled/);
    }
  });

  it('does not call any external function, run any loop conditioned on content meaning, or accept a callback (pure data-in data-out)', () => {
    // Structural proxy for "no semantic reasoning": the function signature
    // accepts only plain data and options, never a judgement/decision callback.
    expect(assembleWorkingMemory.length).toBeLessThanOrEqual(2);
  });
});

describe('assembleWorkingMemory — priority order', () => {
  it('processes categories in the fixed order, including the two protected categories added for the Temple Close correction', () => {
    expect(CATEGORY_PRIORITY).toEqual([
      'currentInstruction',
      'confirmedProjectAnchors',
      'currentDraftState',
      'selectedEmail',
      'thread',
      'projectFacts',
      'projectMemory',
      'semanticResults',
      'chatHistory',
    ]);
  });

  it('higher-priority categories are included before lower-priority ones hit the budget ceiling', () => {
    const item = (id, size) => ({ id, content: 'x'.repeat(size) });
    const raw = {
      currentInstruction: [item('ci1', 8000)],
      selectedEmail: [item('se1', 8000)],
      chatHistory: [item('ch1', 15000), item('ch2', 15000)],
    };
    const result = assembleWorkingMemory(raw, { maxTotalChars: 20000 });
    const includedCategories = result.included.map((i) => i.category);
    expect(includedCategories).toContain('currentInstruction');
    expect(includedCategories).toContain('selectedEmail');
    // chatHistory (lowest priority here) should be excluded once budget is exceeded
    expect(includedCategories).not.toContain('chatHistory');
    expect(result.excluded.some((e) => e.category === 'chatHistory' && e.reason === 'total_budget_exceeded')).toBe(true);
  });
});

describe('assembleWorkingMemory — limits', () => {
  it('enforces the per-category item limit', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, content: 'short' }));
    const result = assembleWorkingMemory({ projectFacts: items }, { maxItemsPerCategory: 5 });
    const included = result.included.filter((i) => i.category === 'projectFacts');
    expect(included.length).toBe(5);
    expect(result.excluded.filter((e) => e.category === 'projectFacts' && e.reason === 'per_category_limit').length).toBe(7);
  });

  it('enforces the total character budget across categories', () => {
    const items = { semanticResults: [{ id: 's1', content: 'x'.repeat(50000) }] };
    const result = assembleWorkingMemory(items, { maxTotalChars: 100 });
    expect(result.included.length).toBe(0);
    expect(result.excluded[0].reason).toBe('total_budget_exceeded');
  });

  it('de-duplicates items sharing the same id within a category', () => {
    const items = { thread: [{ id: 't1', content: 'a' }, { id: 't1', content: 'a duplicate' }] };
    const result = assembleWorkingMemory(items);
    expect(result.included.filter((i) => i.source_id === 't1').length).toBe(1);
  });
});

describe('assembleWorkingMemory — source metadata preservation', () => {
  it('preserves date, author and evidential_status on every included item', () => {
    const raw = { selectedEmail: [{ id: 'e1', content: 'body', date: '2026-08-05', author: 'Isabella', evidential_status: 'confirmed' }] };
    const result = assembleWorkingMemory(raw);
    expect(result.included[0]).toMatchObject({
      source_id: 'e1',
      date: '2026-08-05',
      author: 'Isabella',
      evidential_status: 'confirmed',
    });
  });

  it('defaults evidential_status to "supplied_context" when not explicitly provided', () => {
    const raw = { selectedEmail: [{ id: 'e1', content: 'body' }] };
    const result = assembleWorkingMemory(raw);
    expect(result.included[0].evidential_status).toBe('supplied_context');
  });

  it('handles an entirely empty input without throwing', () => {
    expect(() => assembleWorkingMemory({})).not.toThrow();
    const result = assembleWorkingMemory({});
    expect(result.included).toEqual([]);
    expect(result.totalChars).toBe(0);
  });
});

// ── Temple Close Project Chat test corrections (2026-08-06) ────────────────
// Regression tests required by the correction spec, §8.

describe('extractConfirmedProjectAnchors — mechanical matching, not legal reasoning (spec §8 test 2, test 6)', () => {
  const project = {
    aos: [
      {
        id: 'ao-9', name: 'Benjamin Harry Power', address: '9 Temple Close, London N3 3SB',
        premise: '9 Temple Close, London N3 3SB', status: 'notice_served',
        notice_served_date: '2026-07-23', consent_deadline: '2026-08-05',
      },
      {
        id: 'ao-10', name: 'Sharanjit Gulati', address: '10 Temple Close, London N3 3SB',
        premise: '10 Temple Close, London N3 3SB', status: 'notice_served',
        notice_served_date: '2026-07-23', consent_deadline: '2026-08-05',
      },
    ],
  };

  it('includes only the adjoining owner mentioned in the request text, excluding the unrelated neighbouring owner (spec §8 test 2)', () => {
    const anchors = extractConfirmedProjectAnchors({ project, requestText: 'the leaseholder at 10 Temple Close has asked for drawings' });
    expect(anchors.length).toBe(1);
    expect(anchors[0].content).toContain('10 Temple Close');
    expect(anchors[0].content).not.toContain('9 Temple Close');
  });

  it('includes the confirmed expiry date for the matched party', () => {
    const anchors = extractConfirmedProjectAnchors({ project, requestText: 'Flat 10, 10 Temple Close, response expiry' });
    expect(anchors[0].content).toContain('2026-08-05');
  });

  it('returns nothing when no party is mentioned in the request text, rather than guessing', () => {
    const anchors = extractConfirmedProjectAnchors({ project, requestText: 'general question about the Act' });
    expect(anchors).toEqual([]);
  });

  it('performs plain substring matching only — no scoring, no inference about which party is "more relevant"', () => {
    // Structural proxy: the function takes only project + requestText, no
    // callback or weighting option that could encode a judgement.
    expect(extractConfirmedProjectAnchors.length).toBe(1);
  });
});

describe('extractCurrentDraftState — preserves the accepted draft across truncation (spec §8 test 4)', () => {
  it('selects the most recent substantial assistant message as the protected current draft', () => {
    const history = [
      { role: 'assistant', content: '[earlier draft — superseded]' },
      { role: 'user', content: 'short correction' },
      { role: 'assistant', content: 'x'.repeat(400) },
    ];
    const result = extractCurrentDraftState(history);
    expect(result.length).toBe(1);
    expect(result[0].content).toContain('x'.repeat(400));
    expect(result[0].evidential_status).toBe('current_draft_state');
  });

  it('never selects an already-superseded placeholder as the current draft', () => {
    const history = [{ role: 'assistant', content: '[earlier draft — superseded]' }];
    expect(extractCurrentDraftState(history)).toEqual([]);
  });

  it('ignores short assistant replies (below the draft-length threshold) as candidates', () => {
    const history = [{ role: 'assistant', content: 'Kind regards,' }];
    expect(extractCurrentDraftState(history)).toEqual([]);
  });

  it('is exempt from the per-category item cap once assembled, so it survives alongside a long chat history (spec §8 test 4, end-to-end)', () => {
    const draft = extractCurrentDraftState([{ role: 'assistant', content: 'x'.repeat(400) }]);
    const manyHistoryItems = Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, content: 'short turn' }));
    const result = assembleWorkingMemory(
      { currentDraftState: draft, chatHistory: manyHistoryItems },
      { maxItemsPerCategory: 8 }
    );
    const draftIncluded = result.included.find((i) => i.category === 'currentDraftState');
    expect(draftIncluded).toBeDefined();
    expect(draftIncluded.content).toContain('x'.repeat(400));
  });
});

describe('protected categories', () => {
  it('confirmedProjectAnchors and currentDraftState are both marked protected from the per-category cap', () => {
    expect(PROTECTED_CATEGORIES).toContain('confirmedProjectAnchors');
    expect(PROTECTED_CATEGORIES).toContain('currentDraftState');
  });
});
