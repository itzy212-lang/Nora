import { describe, it, expect } from 'vitest';
import { toHtml } from '../draftUtils';

describe('toHtml: bullets and numbered lists', () => {
  it('turns hyphen bullets into a real list', () => {
    const h = toHtml('Dear James,\n\n- first point\n- second point\n\nKind regards');
    expect(h).toContain('<ul');
    expect(h.match(/<li/g)).toHaveLength(2);
    expect(h).toContain('first point</li>');
    expect(h).not.toContain('- first');
  });
  it('handles an intro line straight above the bullets', () => {
    const h = toHtml('The points raised are:\n- foundations\n- insurance\n\nKind regards');
    expect(h).toMatch(/<p[^>]*>The points raised are:<\/p><ul/);
    expect(h.match(/<li/g)).toHaveLength(2);
  });
  it('joins bullets separated by blank lines into one list', () => {
    const h = toHtml('- one\n\n- two\n\n- three');
    expect(h.match(/<ul/g)).toHaveLength(1);
    expect(h.match(/<li/g)).toHaveLength(3);
  });
  it('accepts *, bullet dot and en dash markers', () => {
    expect(toHtml('* a\n* b').match(/<li/g)).toHaveLength(2);
    expect(toHtml('• a\n• b').match(/<li/g)).toHaveLength(2);
    expect(toHtml('– a\n– b').match(/<li/g)).toHaveLength(2);
  });
  it('renders numbered lists as ol, including with an intro line', () => {
    const h = toHtml('Steps:\n1. serve\n2. wait\n3. award');
    expect(h).toContain('<ol');
    expect(h.match(/<li/g)).toHaveLength(3);
  });
  it('leaves a lone "1." line and hyphens inside sentences alone', () => {
    expect(toHtml('1. only one')).not.toContain('<ol');
    const h = toHtml('Fees are agreed - see below.');
    expect(h).not.toContain('<ul');
  });
  it('keeps ordinary paragraphs, line breaks and bare mode', () => {
    expect(toHtml('Line one\nLine two\n\nNext')).toContain('Line one<br>Line two');
    expect(toHtml('A\n\nB', { gap: null })).toBe('<p>A</p><p>B</p>');
  });
  it('bare mode still renders bullets as a list', () => {
    expect(toHtml('Intro\n- a\n- b', { gap: null })).toContain('<ul');
  });
  it('returns HTML untouched', () => {
    expect(toHtml('<p>hi</p>')).toBe('<p>hi</p>');
  });
});
