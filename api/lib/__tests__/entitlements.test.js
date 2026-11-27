import { describe, it, expect } from 'vitest';
import { effectivePlan, evaluate } from '../entitlements.js';

const NOW = new Date('2026-12-01T10:00:00Z');
const day = n => new Date(NOW.getTime() + n * 864e5).toISOString();

describe('effective plan', () => {
  it('a locked account has no plan, even with a free upgrade', () => {
    expect(effectivePlan({ status: 'locked', complimentary_plan: 'complete' }, NOW).plan).toBe('none');
  });
  it('a free upgrade with no end date lasts indefinitely', () => {
    expect(effectivePlan({ status: 'active', plan: 'essentials', complimentary_plan: 'complete', complimentary_until: null }, NOW)).toEqual({ plan: 'complete', reason: 'complimentary_indefinite' });
  });
  it('a free upgrade stops on its end date and the paid plan applies again', () => {
    const row = { status: 'active', plan: 'essentials', complimentary_plan: 'complete' };
    expect(effectivePlan({ ...row, complimentary_until: day(3) }, NOW).plan).toBe('complete');
    expect(effectivePlan({ ...row, complimentary_until: day(-1) }, NOW).plan).toBe('essentials');
  });
  it('a trial gives Complete until it ends, then needs a subscription', () => {
    expect(effectivePlan({ status: 'trial', trial_ends_at: day(5) }, NOW).plan).toBe('complete');
    expect(effectivePlan({ status: 'trial', trial_ends_at: day(-1) }, NOW)).toEqual({ plan: 'none', reason: 'trial_expired' });
  });
  it('no row means no plan', () => {
    expect(effectivePlan(null, NOW).plan).toBe('none');
  });
});

describe('feature check', () => {
  const essentials = { status: 'active', plan: 'essentials' };
  it('essentials gets the non-AI features only', () => {
    expect(evaluate(essentials, 'generators', NOW).allowed).toBe(true);
    expect(evaluate(essentials, 'soc_ai', NOW)).toMatchObject({ allowed: false, reason: 'plan_too_low', needs: 'inspect' });
    expect(evaluate(essentials, 'ai_drafting', NOW).allowed).toBe(false);
  });
  it('inspect adds the AI schedule of condition but not drafting', () => {
    const inspect = { status: 'active', plan: 'inspect' };
    expect(evaluate(inspect, 'soc_ai', NOW).allowed).toBe(true);
    expect(evaluate(inspect, 'ai_drafting', NOW).allowed).toBe(false);
  });
  it('complete gets everything, and an unknown feature is refused', () => {
    const complete = { status: 'active', plan: 'complete' };
    expect(evaluate(complete, 'project_memory', NOW).allowed).toBe(true);
    expect(evaluate(complete, 'nonsense', NOW).allowed).toBe(false);
  });
});
