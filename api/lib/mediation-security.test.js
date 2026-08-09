import { describe, expect, it } from 'vitest';
import { randomToken, hashToken, timingSafeHashEqual } from './mediation-security.js';

describe('mediation token security', () => {
  it('generates opaque non-repeating tokens', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(30);
  });

  it('stores only deterministic token hashes', () => {
    const token = randomToken();
    const hash = hashToken(token);
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
    expect(hashToken(token)).toBe(hash);
  });

  it('uses timing-safe equality for fixed hashes', () => {
    const token = randomToken();
    const hash = hashToken(token);
    expect(timingSafeHashEqual(hash, hash)).toBe(true);
    expect(timingSafeHashEqual(hash, hashToken(randomToken()))).toBe(false);
  });
});
