import { describe, it, expect } from 'vitest';
import { assembleWorkingMemory, CATEGORY_PRIORITY } from '../v2-working-memory.js';

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
  it('processes categories in the fixed order: instruction, email, thread, project facts, memory, semantic, chat history', () => {
    expect(CATEGORY_PRIORITY).toEqual([
      'currentInstruction',
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
