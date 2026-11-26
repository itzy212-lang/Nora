import { describe, it, expect } from 'vitest';
import { formatUserKnowledge, withUserKnowledge, buildSummaryMessages, KNOWLEDGE_MAX_CHARS } from '../user-knowledge.js';

describe('user knowledge', () => {
  it('returns null for empty', () => expect(formatUserKnowledge('  ')).toBeNull());
  it('labels as private and caps size', () => {
    const out = formatUserKnowledge('x'.repeat(KNOWLEDGE_MAX_CHARS + 500));
    expect(out).toMatch(/private to this user/);
    expect(out.length).toBeLessThan(KNOWLEDGE_MAX_CHARS + 600);
  });
  it('is attached only when the shared layer is present', () => {
    const brain = { knowledge_content: 'My CPD note' };
    expect(withUserKnowledge(null, brain)).toBeNull();
    expect(withUserKnowledge('SHARED', brain)).toContain('My CPD note');
    expect(withUserKnowledge('SHARED', { knowledge_content: '' })).toBe('SHARED');
    expect(withUserKnowledge('SHARED', null)).toBe('SHARED');
  });
  it('summary prompt forbids invention', () => {
    const m = buildSummaryMessages('a'.repeat(300), 'x.pdf');
    expect(m[0].content).toMatch(/Do not add anything/);
    expect(m[1].content).toContain('x.pdf');
  });
});
