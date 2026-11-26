import { describe, it, expect } from 'vitest';
import { modelFor, isReasoningModel, tokenParams, instructionRole, normaliseEffort, FUNCTIONS } from '../model-config.js';

describe('model-config', () => {
  it('every function defaults to Sol (gpt-4o stays only as the fallback)', () => {
    expect(modelFor('chat_main', {}).model).toBe('gpt-6.2-sol');
    expect(modelFor('soc_draft', {}).model).toBe('gpt-6.2-sol');
    expect(modelFor('soc_live', {}).model).toBe('gpt-6.2-sol');
    expect(modelFor('minutes_extract', {}).model).toBe('gpt-6.2-sol');
    expect(modelFor('chat_main', {}).fallbackModel).toBe('gpt-4o');
    expect(modelFor('chat_main', {}).reasoningEffort).toBe('medium');
  });
  it('one variable switches every core function (rollback to Terra), and per-function overrides win', () => {
    const env = { NORA_CORE_MODEL: 'gpt-5.6-terra' };
    for (const [fn, spec] of Object.entries(FUNCTIONS)) {
      expect(modelFor(fn, env).model).toBe(spec.tier === 'core' ? 'gpt-5.6-terra' : modelFor(fn, {}).model);
    }
    expect(modelFor('minutes_draft', { ...env, NORA_MODEL_MINUTES_DRAFT: 'gpt-6.2-sol' }).model).toBe('gpt-6.2-sol');
  });
  it('recognises reasoning models including the 6.x family', () => {
    for (const m of ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6.2-sol', 'gpt-6.2-astra', 'o3']) expect(isReasoningModel(m)).toBe(true);
    for (const m of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1']) expect(isReasoningModel(m)).toBe(false);
  });
  it('builds the right parameters and never sends temperature to reasoning models', () => {
    expect(tokenParams('gpt-6.2-sol', { maxTokens: 4000, reasoningEffort: 'medium', jsonMode: true }))
      .toEqual({ max_completion_tokens: 4000, reasoning_effort: 'medium' });
    expect(tokenParams('gpt-4o', { maxTokens: 4000, jsonMode: true }))
      .toEqual({ max_tokens: 4000, response_format: { type: 'json_object' } });
    expect(instructionRole('gpt-6.2-sol')).toBe('developer');
    expect(instructionRole('gpt-4o')).toBe('system');
  });
  it('maps effort values GPT-6 rejects to low, leaves 5.6 alone', () => {
    expect(normaliseEffort('gpt-6.2-sol', 'none')).toBe('low');
    expect(normaliseEffort('gpt-6.2-sol', 'minimal')).toBe('low');
    expect(normaliseEffort('gpt-5.6-terra', 'minimal')).toBe('minimal');
  });
  it('rejects unknown function names', () => {
    expect(() => modelFor('nope', {})).toThrow();
  });
});
