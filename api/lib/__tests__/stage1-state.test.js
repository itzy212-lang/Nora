import { describe, it, expect } from 'vitest';
import { isExactlyTrue, resolveStage1State, computeBriefForInjection, STAGE1_STATE } from '../stage1-state.js';

describe('stage1-state: isExactlyTrue', () => {
  it('accepts only the exact string "true"', () => {
    expect(isExactlyTrue('true')).toBe(true);
  });

  it.each([
    ['True', 'differently cased'],
    ['TRUE', 'upper case'],
    ['1', 'numeric string'],
    ['yes', 'word alternative'],
    [' true', 'leading whitespace'],
    ['true ', 'trailing whitespace'],
    ['', 'empty string'],
    [undefined, 'missing/undefined'],
    [null, 'null'],
    [true, 'actual boolean true, not a string'],
  ])('rejects %j (%s)', (value) => {
    expect(isExactlyTrue(value)).toBe(false);
  });
});

describe('stage1-state: resolveStage1State', () => {
  it('resolves OFF when STAGE1_DRAFTING is missing', () => {
    const { state, draftingEnabled, promotedEnabled } = resolveStage1State({});
    expect(state).toBe(STAGE1_STATE.OFF);
    expect(draftingEnabled).toBe(false);
    expect(promotedEnabled).toBe(false);
  });

  it('resolves OFF when STAGE1_DRAFTING is a near-miss value, even if STAGE1_PROMOTED is exactly "true"', () => {
    const { state } = resolveStage1State({ stage1DraftingEnv: 'True', stage1PromotedEnv: 'true' });
    expect(state).toBe(STAGE1_STATE.OFF);
  });

  it('resolves SHADOW when STAGE1_DRAFTING="true" and STAGE1_PROMOTED is missing', () => {
    const { state, draftingEnabled, promotedEnabled } = resolveStage1State({ stage1DraftingEnv: 'true' });
    expect(state).toBe(STAGE1_STATE.SHADOW);
    expect(draftingEnabled).toBe(true);
    expect(promotedEnabled).toBe(false);
  });

  it('resolves SHADOW when STAGE1_DRAFTING="true" and STAGE1_PROMOTED="false"', () => {
    const { state } = resolveStage1State({ stage1DraftingEnv: 'true', stage1PromotedEnv: 'false' });
    expect(state).toBe(STAGE1_STATE.SHADOW);
  });

  it('resolves PROMOTED_CANDIDATE only when both flags are exactly "true"', () => {
    const { state, draftingEnabled, promotedEnabled } = resolveStage1State({ stage1DraftingEnv: 'true', stage1PromotedEnv: 'true' });
    expect(state).toBe(STAGE1_STATE.PROMOTED_CANDIDATE);
    expect(draftingEnabled).toBe(true);
    expect(promotedEnabled).toBe(true);
  });

  it('never resolves PROMOTED_CANDIDATE from STAGE1_PROMOTED alone', () => {
    const { state } = resolveStage1State({ stage1PromotedEnv: 'true' });
    expect(state).toBe(STAGE1_STATE.OFF);
  });
});

describe('stage1-state: computeBriefForInjection', () => {
  const brief = { user_objective: 'x' };

  it('returns null in OFF state', () => {
    expect(computeBriefForInjection({ state: STAGE1_STATE.OFF, generationSucceeded: true, validationPassed: true, brief })).toBeNull();
  });

  it('returns null in SHADOW state even with successful generation and passed validation', () => {
    expect(computeBriefForInjection({ state: STAGE1_STATE.SHADOW, generationSucceeded: true, validationPassed: true, brief })).toBeNull();
  });

  it('returns null in PROMOTED_CANDIDATE state if generation failed', () => {
    expect(computeBriefForInjection({ state: STAGE1_STATE.PROMOTED_CANDIDATE, generationSucceeded: false, validationPassed: true, brief })).toBeNull();
  });

  it('returns null in PROMOTED_CANDIDATE state if validation failed', () => {
    expect(computeBriefForInjection({ state: STAGE1_STATE.PROMOTED_CANDIDATE, generationSucceeded: true, validationPassed: false, brief })).toBeNull();
  });

  it('returns the brief only in PROMOTED_CANDIDATE state with successful generation and passed validation', () => {
    expect(computeBriefForInjection({ state: STAGE1_STATE.PROMOTED_CANDIDATE, generationSucceeded: true, validationPassed: true, brief })).toBe(brief);
  });

  it('returns null for a malformed/missing brief even in an otherwise-promoting state', () => {
    expect(computeBriefForInjection({ state: STAGE1_STATE.PROMOTED_CANDIDATE, generationSucceeded: true, validationPassed: true, brief: null })).toBeNull();
  });
});
