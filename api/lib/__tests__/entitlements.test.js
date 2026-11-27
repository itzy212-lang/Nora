import { describe, it, expect } from 'vitest';
import { effectiveAccess, evaluate } from '../entitlements.js';

const NOW = new Date('2026-12-01T10:00:00Z');
const day = n => new Date(NOW.getTime() + n * 864e5).toISOString();

describe('effective access', () => {
  it('a locked account has nothing, even with free access', () => {
    expect(effectiveAccess({ status: 'locked', complimentary_addons: ['soc', 'assistant'] }, NOW).core).toBe(false);
  });
  it('free access with no end date lasts indefinitely', () => {
    expect(effectiveAccess({ status: 'active', addons: [], complimentary_addons: ['soc', 'assistant'], complimentary_until: null }, NOW))
      .toEqual({ core: true, addons: ['soc', 'assistant'], reason: 'complimentary_indefinite' });
  });
  it('free access stops on its end date and the paid bolt-ons apply again', () => {
    const row = { status: 'active', addons: ['soc'], complimentary_addons: ['soc', 'assistant'] };
    expect(effectiveAccess({ ...row, complimentary_until: day(3) }, NOW).addons).toEqual(['soc', 'assistant']);
    expect(effectiveAccess({ ...row, complimentary_until: day(-1) }, NOW)).toEqual({ core: true, addons: ['soc'], reason: 'subscription' });
  });
  it('free Core only (empty list) is still free access to Core', () => {
    expect(effectiveAccess({ status: 'active', addons: [], complimentary_addons: [] }, NOW)).toMatchObject({ core: true, addons: [] });
  });
  it('paid and free bolt-ons add together', () => {
    expect(effectiveAccess({ status: 'active', addons: ['assistant'], complimentary_addons: ['soc'] }, NOW).addons.sort()).toEqual(['assistant', 'soc']);
  });
  it('a trial gives everything until it ends, then nothing', () => {
    expect(effectiveAccess({ status: 'trial', trial_ends_at: day(5) }, NOW)).toEqual({ core: true, addons: ['soc', 'assistant'], reason: 'trial' });
    expect(effectiveAccess({ status: 'trial', trial_ends_at: day(-1) }, NOW)).toEqual({ core: false, addons: [], reason: 'trial_expired' });
  });
  it('no row means no access', () => {
    expect(effectiveAccess(null, NOW).core).toBe(false);
  });
  it('ignores unknown bolt-on names', () => {
    expect(effectiveAccess({ status: 'active', addons: ['soc', 'bogus'] }, NOW).addons).toEqual(['soc']);
  });
});

describe('feature check', () => {
  const core = { status: 'active', addons: [] };
  it('core alone gets the non-AI features only', () => {
    expect(evaluate(core, 'generators', NOW).allowed).toBe(true);
    expect(evaluate(core, 'soc_ai', NOW)).toMatchObject({ allowed: false, reason: 'bolt_on_missing', needs: 'soc' });
    expect(evaluate(core, 'ai_drafting', NOW)).toMatchObject({ allowed: false, needs: 'assistant' });
    expect(evaluate(core, 'auto_link_emails', NOW).allowed).toBe(true);
  });
  it('the Schedule of Condition bolt-on adds only the AI schedule of condition', () => {
    const soc = { status: 'active', addons: ['soc'] };
    expect(evaluate(soc, 'soc_ai', NOW).allowed).toBe(true);
    expect(evaluate(soc, 'ai_drafting', NOW).allowed).toBe(false);
  });
  it('the Nora Assistant bolt-on adds drafting, chat and memory but not the schedule of condition', () => {
    const assistant = { status: 'active', addons: ['assistant'] };
    for (const f of ['ai_drafting', 'project_chat', 'main_chat', 'project_memory']) expect(evaluate(assistant, f, NOW).allowed).toBe(true);
    expect(evaluate(assistant, 'soc_ai', NOW).allowed).toBe(false);
  });
  it('all three together get everything, and an unknown feature is refused', () => {
    const all = { status: 'active', addons: ['soc', 'assistant'] };
    expect(evaluate(all, 'project_memory', NOW).allowed).toBe(true);
    expect(evaluate(all, 'soc_ai', NOW).allowed).toBe(true);
    expect(evaluate(all, 'nonsense', NOW).allowed).toBe(false);
  });
  it('an expired trial is refused with its reason', () => {
    expect(evaluate({ status: 'trial', trial_ends_at: day(-1) }, 'generators', NOW)).toMatchObject({ allowed: false, reason: 'trial_expired' });
  });
});
