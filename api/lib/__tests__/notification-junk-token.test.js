import { describe, it, expect } from 'vitest';
import { makeJunkToken, verifyJunkToken } from '../notification-junk-token.js';

describe('junk token', () => {
  it('verifies for the same email and secret', () => {
    const t = makeJunkToken('abc', 's3cret');
    expect(verifyJunkToken('abc', t, 's3cret')).toBe(true);
  });
  it('rejects another email, a wrong secret, or no token', () => {
    const t = makeJunkToken('abc', 's3cret');
    expect(verifyJunkToken('xyz', t, 's3cret')).toBe(false);
    expect(verifyJunkToken('abc', t, 'other')).toBe(false);
    expect(verifyJunkToken('abc', '', 's3cret')).toBe(false);
    expect(verifyJunkToken('abc', 'short', 's3cret')).toBe(false);
  });
  it('makes no token without a secret or id', () => {
    expect(makeJunkToken('abc', '')).toBeNull();
    expect(makeJunkToken('', 's3cret')).toBeNull();
  });
});
