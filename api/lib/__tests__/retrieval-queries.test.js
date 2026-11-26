import { describe, it, expect } from 'vitest';
import { buildConversationSearchQuery, excludeCurrentSessionChat, extractLiteralTerms, snippetsAroundTerms } from '../retrieval-queries.js';

describe('buildConversationSearchQuery', () => {
  const hist = [
    { role: 'user', content: 'Booked for today with number 16, I have it down for 3pm' },
    { role: 'assistant', content: 'I cannot find it' },
    { role: 'user', content: 'Sorry, number 20' },
  ];
  it('keeps the earlier meaning for a follow-up', () => {
    const q = buildConversationSearchQuery('Can you find their email?', hist);
    expect(q).toContain('3pm');
    expect(q.endsWith('Can you find their email?')).toBe(true);
  });
  it('does not repeat the current prompt and handles no history', () => {
    expect(buildConversationSearchQuery('hello', [{ role: 'user', content: 'hello' }])).toBe('hello');
    expect(buildConversationSearchQuery('hello', undefined)).toBe('hello');
  });
});

describe('excludeCurrentSessionChat', () => {
  it('drops own messages but keeps emails and older chats', () => {
    const results = [
      { content_type: 'chat', content: 'Can you find their email?' },
      { content_type: 'chat', content: 'An older, different chat' },
      { content_type: 'email', content: 'Can you find their email?' },
    ];
    const out = excludeCurrentSessionChat(results, 'Can you find their email?', []);
    expect(out).toHaveLength(2);
    expect(out.some((r) => r.content === 'An older, different chat')).toBe(true);
  });
});

describe('extractLiteralTerms', () => {
  it('finds times and dates in the conversation words', () => {
    const t = extractLiteralTerms('Booked at 3pm, scheduled for 26 November at 3:00pm');
    expect(t).toEqual(expect.arrayContaining(['3pm', '3:00pm', '26 November']));
  });
  it('finds month-first dates and minutes', () => {
    const t = extractLiteralTerms('Thursday 26th November, or November 9 at 2.30pm');
    expect(t).toEqual(expect.arrayContaining(['26 November', '9 November', '2:30pm']));
  });
  it('returns nothing when there is nothing literal', () => {
    expect(extractLiteralTerms('Sorry, number 20, not number 16')).toEqual([]);
  });
});

describe('snippetsAroundTerms', () => {
  const long = '<p>Thank you.</p>' + '<p>filler text</p>'.repeat(300) + '<p>Hi Sarah, Thursday 26 November at 3pm works for me.</p>';
  const rows = [
    { id: 'a', subject: 'RE: Party Wall', direction: 'incoming', sender_name: 'Sarah Fedak', received_at: '2026-11-17', body: long },
    { id: 'b', subject: 'Other', direction: 'outgoing', received_at: '2026-11-10', body: '<p>Nothing here</p>' },
    { id: 'c', subject: 'RE: Party Wall', direction: 'outgoing', received_at: '2026-11-16', body: long },
  ];
  it('quotes a fact buried deep in a long email, once, with context', () => {
    const out = snippetsAroundTerms(rows, ['3pm']);
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('Thursday 26 November at 3pm works for me');
    expect(out[0].content).toContain('Sarah Fedak');
  });
  it('returns nothing with no terms', () => expect(snippetsAroundTerms(rows, [])).toEqual([]));
});
