import { describe, it, expect } from 'vitest';
import { aoNoNoticeDays } from '../aoAttention';

const NOW = new Date('2026-11-28T12:00:00Z').getTime();
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();

describe('aoNoNoticeDays', () => {
  it('flags an owner added 7+ days ago with nothing served', () => {
    expect(aoNoNoticeDays({ status: 'details_added', added_at: daysAgo(22) }, null, NOW)).toBe(22);
    expect(aoNoNoticeDays({ added_at: daysAgo(7) }, null, NOW)).toBe(7);
  });
  it('does not flag before 7 days', () => {
    expect(aoNoNoticeDays({ added_at: daysAgo(6) }, null, NOW)).toBeNull();
  });
  it('falls back to the project date when the owner has none', () => {
    expect(aoNoNoticeDays({}, daysAgo(10), NOW)).toBe(10);
    expect(aoNoNoticeDays({}, null, NOW)).toBeNull();
  });
  it('does not flag once anything has been done', () => {
    expect(aoNoNoticeDays({ added_at: daysAgo(30), notice_served_date: '2026-11-01' }, null, NOW)).toBeNull();
    expect(aoNoNoticeDays({ added_at: daysAgo(30), status: 'consent' }, null, NOW)).toBeNull();
    expect(aoNoNoticeDays({ added_at: daysAgo(30), status: 'dissent' }, null, NOW)).toBeNull();
    expect(aoNoNoticeDays({ added_at: daysAgo(30), appointed_by_me: true }, null, NOW)).toBeNull();
  });
});
