import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { lastProgressTime, daysSinceProgress } from '../aoProgress';

const NOW = new Date('2026-10-13T14:00:00Z').getTime();

describe('AO progress', () => {
  it('119 Silvermere Road: SOC on 5 Oct beats a status change on 28 July (was "No progress - 76d")', () => {
    const ao = { status: 'dissent', last_status_change: '2026-07-28T17:26:54.647Z', notice_served_date: '2026-07-12', soc_date: '2026-10-05', soc_agreed_date: '2026-10-05' };
    expect(daysSinceProgress(ao, NOW)).toBe(8);
  });
  it('a booked (future) SOC means the job is not stale', () => {
    expect(daysSinceProgress({ last_status_change: '2026-07-28', soc_date: '2026-10-20' }, NOW)).toBe(0);
  });
  it('falls back to the status change when nothing else is dated', () => {
    expect(daysSinceProgress({ last_status_change: '2026-09-13T14:00:00Z' }, NOW)).toBe(30);
  });
  it('uses Section 10 / 10(4)(b) / consent dates too, and ignores future ones other than SOC', () => {
    expect(daysSinceProgress({ last_status_change: '2026-07-01', s10_served_date: '2026-10-01' }, NOW)).toBe(12);
    expect(daysSinceProgress({ last_status_change: '2026-07-01', s104b_served_date: '2026-10-10' }, NOW)).toBe(3);
    expect(daysSinceProgress({ last_status_change: '2026-10-01', s10_served_date: '2027-01-01' }, NOW)).toBe(12);
  });
  it('returns null with no dates at all', () => {
    expect(lastProgressTime({}, NOW)).toBeNull();
    expect(lastProgressTime(null, NOW)).toBeNull();
  });
  it('the serverless copy is identical to the front-end copy', () => {
    expect(fs.readFileSync('api/lib/aoProgress.js', 'utf8')).toBe(fs.readFileSync('src/utils/aoProgress.js', 'utf8'));
  });
});
