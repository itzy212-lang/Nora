import { describe, it, expect } from 'vitest';
import { buildAwardPlaceholders } from '../buildAwardPlaceholders';

const project = { id: 'p', bo_1_name: 'Test BO', bo_1_premise: '1 Silvermere Road', address: '1 Silvermere Road' };
const ao = {
  id: '123', name: 'AO Name', premise: '3 Silvermere Road', status: 's104b',
  notice_served_date: '2026-07-12', s10_served_date: '2026-09-04',
  s104b_served_date: '2026-09-23', soc_agreed_date: '2026-10-05',
  surv_name: 'Jiten Wagjiani', surv_firm: 'Firm', third_surveyor_name: 'Alex M. Frame',
};

describe('10(4)(b) award', () => {
  it('uses award_s10 and the three distinct dates', () => {
    const r = buildAwardPlaceholders(project, ao, { noticeDate: '2026-07-12' });
    expect(r.templateKey).toBe('award_s10');
    expect(r.mergeData.NOTICE_DATE).toBe('12th July 2026');
    expect(r.mergeData.SECTION_10_NOTICE_DATE).toBe('4th September 2026');
    expect(r.mergeData.SECTION_10_4_B_DATE).toBe('23rd September 2026');
  });
  it('actual served notice row date beats a stale AO column', () => {
    const r = buildAwardPlaceholders(project, { ...ao, notice_served_date: '2026-06-01' }, { noticeDate: '2026-07-12' });
    expect(r.mergeData.NOTICE_DATE).toBe('12th July 2026');
  });
  it('never invents today as the notice date; flags it missing instead', () => {
    const r = buildAwardPlaceholders(project, { ...ao, notice_served_date: '' }, {});
    expect(r.missing).toContain('Notice date');
  });
});
