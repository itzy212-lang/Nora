import { describe, it, expect } from 'vitest';
import { V2_ALLOWLIST, isV2Enabled, isV2AllowedForUser, resolveArchitectureVersion, buildDiagnosticsEnvelope } from '../v2-operating-system.js';

const ITZIK_UUID = '3bd1f331-e8ce-477a-8a5d-c5dcdd901434';
const OTHER_UUID = '00000000-0000-0000-0000-000000000000';

describe('V2 routing — flag AND allowlist both required', () => {
  it('flag on, allowlisted user -> v2', () => {
    expect(resolveArchitectureVersion({ brainVersionEnv: 'v2', userId: ITZIK_UUID })).toBe('v2');
  });

  it('flag on, non-allowlisted user -> v1', () => {
    expect(resolveArchitectureVersion({ brainVersionEnv: 'v2', userId: OTHER_UUID })).toBe('v1');
  });

  it('flag off, allowlisted user -> v1', () => {
    expect(resolveArchitectureVersion({ brainVersionEnv: 'v1', userId: ITZIK_UUID })).toBe('v1');
  });

  it('flag off, non-allowlisted user -> v1', () => {
    expect(resolveArchitectureVersion({ brainVersionEnv: 'v1', userId: OTHER_UUID })).toBe('v1');
  });

  it('flag unset entirely, allowlisted user -> v1', () => {
    expect(resolveArchitectureVersion({ brainVersionEnv: undefined, userId: ITZIK_UUID })).toBe('v1');
  });

  it('missing userId -> v1 regardless of flag', () => {
    expect(resolveArchitectureVersion({ brainVersionEnv: 'v2', userId: null })).toBe('v1');
    expect(resolveArchitectureVersion({ brainVersionEnv: 'v2', userId: undefined })).toBe('v1');
  });

  it('always returns exactly one of the two literal strings', () => {
    const inputs = [
      { brainVersionEnv: 'v2', userId: ITZIK_UUID },
      { brainVersionEnv: 'v1', userId: ITZIK_UUID },
      { brainVersionEnv: 'v2', userId: OTHER_UUID },
      { brainVersionEnv: 'garbage', userId: ITZIK_UUID },
    ];
    for (const input of inputs) {
      const result = resolveArchitectureVersion(input);
      expect(['v1', 'v2']).toContain(result);
    }
  });
});

describe('V2 allowlist helpers', () => {
  it('isV2AllowedForUser matches only the real Itzik UUID', () => {
    expect(isV2AllowedForUser(ITZIK_UUID)).toBe(true);
    expect(isV2AllowedForUser(OTHER_UUID)).toBe(false);
    expect(isV2AllowedForUser(null)).toBe(false);
  });

  it('isV2Enabled matches only the exact string "v2"', () => {
    expect(isV2Enabled('v2')).toBe(true);
    expect(isV2Enabled('V2')).toBe(false);
    expect(isV2Enabled('v1')).toBe(false);
    expect(isV2Enabled(undefined)).toBe(false);
  });

  it('the allowlist itself contains exactly the approved initial user', () => {
    expect(V2_ALLOWLIST).toEqual([ITZIK_UUID]);
  });
});

describe('Diagnostics envelope — requested vs. observed reasoning kept separate', () => {
  it('never conflates requested effort with observed token count', () => {
    const envelope = buildDiagnosticsEnvelope({
      architectureVersion: 'v2',
      modelReturned: 'gpt-5.6-terra',
      requestedReasoningEffort: 'medium',
      observedReasoningTokens: 127,
      surface: 'inbox_draft',
      modeHint: 'draft',
    });
    expect(envelope.reasoning_effort_requested).toBe('medium');
    expect(envelope.reasoning_tokens_observed).toBe(127);
    // Distinct fields, not merged into one "confirmed effort" value.
    expect(envelope).not.toHaveProperty('reasoning_effort_confirmed');
    expect(envelope).not.toHaveProperty('confirmed_reasoning_tier');
  });

  it('handles a zero observed-token value without coercing it to null (0 is meaningful, not missing)', () => {
    const envelope = buildDiagnosticsEnvelope({ observedReasoningTokens: 0 });
    expect(envelope.reasoning_tokens_observed).toBe(0);
  });

  it('records fallback_occurred explicitly as a boolean', () => {
    const envelope = buildDiagnosticsEnvelope({ fallbackOccurred: true });
    expect(envelope.fallback_occurred).toBe(true);
  });

  it('prompt_sections records name and character count only, not raw content (diagnostics should not duplicate the full prompt)', () => {
    const envelope = buildDiagnosticsEnvelope({
      promptSections: [{ name: 'universal_brain', content: 'x'.repeat(500) }],
    });
    expect(envelope.prompt_sections).toEqual([{ name: 'universal_brain', chars: 500 }]);
  });
});
