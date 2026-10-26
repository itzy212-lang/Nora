import { describe, it, expect } from 'vitest';
import { buildAwardPlaceholders } from '../buildAwardPlaceholders';

const run = (o) => buildAwardPlaceholders({}, {}, { noticeRuns: o }).mergeData.FULL_NOTICE_RUNS;

describe('FULL_NOTICE_RUNS', () => {
  it('single notice: sections and date', () => {
    expect(run([{ run_number: 1, notice_date: '2026-09-25', section_6: true }])).toBe('Section 6(1) dated 25th September 2026');
  });
  it('two notices in run order, with subsections', () => {
    expect(run([
      { run_number: 2, notice_date: '2026-09-28', section_2: true, section_2_subsections: 'f, g' },
      { run_number: 1, notice_date: '2026-09-25', section_1: true },
    ])).toBe('Section 1(5) dated 25th September 2026 and Section 2(2)(f)(g) dated 28th September 2026');
  });
  it('three notices', () => {
    expect(run([
      { run_number: 1, notice_date: '2026-01-01', section_6: true },
      { run_number: 2, notice_date: '2026-02-01', section_1: true },
      { run_number: 3, notice_date: '2026-03-01', section_2: true, section_2_subsections: 'j' },
    ])).toBe('Section 6(1) dated 1st January 2026, Section 1(5) dated 1st February 2026 and Section 2(2)(j) dated 1st March 2026');
  });
  it('no notices: empty', () => { expect(run([])).toBe(''); });
});
