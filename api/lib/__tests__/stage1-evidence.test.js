import { describe, it, expect } from 'vitest';
import { normaliseForMatch, verifyExcerpt, verifyAllExcerpts } from '../stage1-evidence.js';
import { minimalValidBrief, minimalSourceIdMap } from './fixtures.js';

describe('stage1-evidence: normaliseForMatch', () => {
  it('collapses whitespace and newlines', () => {
    expect(normaliseForMatch('hello   \n\n world')).toBe('hello world');
  });

  it('normalises curly quotes and dashes to plain equivalents', () => {
    expect(normaliseForMatch('it\u2019s the buildingowner\u2019s wall \u2014 confirmed')).toBe(
      "it's the buildingowner's wall - confirmed"
    );
  });

  it('lowercases', () => {
    expect(normaliseForMatch('HELLO')).toBe('hello');
  });
});

describe('stage1-evidence: verifyExcerpt', () => {
  const sourceIdMap = { email_0001: 'We confirm the Building Owner will appoint a surveyor within 14 days.' };

  it('passes on an exact match', () => {
    expect(verifyExcerpt('the Building Owner will appoint a surveyor', 'email_0001', sourceIdMap)).toBe(true);
  });

  it('passes on a match that differs only by whitespace/punctuation', () => {
    expect(verifyExcerpt('the   Building Owner\nwill appoint a surveyor', 'email_0001', sourceIdMap)).toBe(true);
  });

  it('rejects a materially altered quotation (different word)', () => {
    // "will not appoint" was never said — this must fail, not be normalised away.
    expect(verifyExcerpt('the Building Owner will not appoint a surveyor', 'email_0001', sourceIdMap)).toBe(false);
  });

  it('rejects a quotation with a substituted figure', () => {
    expect(verifyExcerpt('within 30 days', 'email_0001', sourceIdMap)).toBe(false);
  });

  it('rejects an excerpt against an unknown source_id', () => {
    expect(verifyExcerpt('anything', 'email_9999', sourceIdMap)).toBe(false);
  });

  it('rejects an empty excerpt', () => {
    expect(verifyExcerpt('', 'email_0001', sourceIdMap)).toBe(false);
  });

  it('rejects when sourceIdMap is missing or malformed', () => {
    expect(verifyExcerpt('anything', 'email_0001', null)).toBe(false);
    expect(verifyExcerpt('anything', 'email_0001', undefined)).toBe(false);
  });
});

describe('stage1-evidence: verifyAllExcerpts', () => {
  it('reports all-passing for a fully consistent minimal brief', () => {
    const report = verifyAllExcerpts(minimalValidBrief(), minimalSourceIdMap());
    expect(report.failed).toBe(0);
    expect(report.total).toBeGreaterThan(0);
    expect(report.passed).toBe(report.total);
  });

  it('reports a failure when one excerpt has been materially altered', () => {
    const brief = minimalValidBrief();
    brief.material_changes[0].excerpt = 'I have NOT appointed a surveyor to act for me';
    const report = verifyAllExcerpts(brief, minimalSourceIdMap());
    expect(report.failed).toBe(1);
    const failedEntry = report.details.find((d) => !d.valid);
    expect(failedEntry.path).toBe('material_changes[0]');
  });

  it('checks both earlier and later excerpts on implied_changes_of_position independently', () => {
    const brief = minimalValidBrief();
    brief.implied_changes_of_position.push({
      position_change_id: 'position_change_01',
      description: 'Position shifted.',
      earlier_source_id: 'email_0001',
      earlier_excerpt: 'we served notice on 1 June',
      later_source_id: 'email_0002',
      later_excerpt: 'this excerpt does not exist in the source',
      confidence: 'medium',
    });
    const report = verifyAllExcerpts(brief, minimalSourceIdMap());
    const earlier = report.details.find((d) => d.path === 'implied_changes_of_position[0].earlier');
    const later = report.details.find((d) => d.path === 'implied_changes_of_position[0].later');
    expect(earlier.valid).toBe(true);
    expect(later.valid).toBe(false);
  });
});
