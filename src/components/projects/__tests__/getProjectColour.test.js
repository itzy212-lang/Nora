import { describe, it, expect } from 'vitest';
import { getProjectColour } from '../ProjectList.jsx';

// Regression coverage for the 2026-10-01 fix: 8 Biggin Avenue's two
// AOs had both progressed to status 'award' (a surveyor already
// appointed, SOC carried out, award being drafted) with a consent
// deadline from back in May - entirely expected at that stage - but
// the project list still showed the card red, because the overdue-
// consent-deadline check only ever excluded the literal statuses
// 'consent'/'dissent', never recognising 'award' (or any other
// later-stage status) as already past that point.

function makeAO(overrides = {}) {
  return {
    status: 'award',
    consent_deadline: '2026-05-26',
    surv_name: 'Alex M. Frame',
    agreed_surveyor: false,
    award_deadline: '2026-10-04',
    ...overrides,
  };
}

describe('getProjectColour', () => {
  it('is not red for an AO at the award stage with a long-expired consent deadline and an appointed surveyor', () => {
    const project = { aos: [makeAO()] };
    expect(getProjectColour(project)).not.toBe('#ef4444');
  });

  it('is not red when the surveyor was appointed via agreed_surveyor rather than a named surveyor', () => {
    const project = { aos: [makeAO({ surv_name: null, agreed_surveyor: true })] };
    expect(getProjectColour(project)).not.toBe('#ef4444');
  });

  it('is still red for a genuinely stalled dissent with no surveyor appointed and an overdue consent deadline', () => {
    const project = {
      aos: [{
        status: 'notice_served',
        consent_deadline: '2026-05-26',
        surv_name: null,
        agreed_surveyor: false,
      }],
    };
    expect(getProjectColour(project)).toBe('#ef4444');
  });

  it('is still red for a genuinely overdue S10 deadline with no surveyor appointed', () => {
    const project = {
      aos: [{
        status: 's10',
        s10_deadline: '2026-05-26',
        surv_name: null,
        agreed_surveyor: false,
      }],
    };
    expect(getProjectColour(project)).toBe('#ef4444');
  });

  it('returns grey for a project with no AOs at all', () => {
    expect(getProjectColour({ aos: [] })).toBe('#9ca3af');
  });
});
