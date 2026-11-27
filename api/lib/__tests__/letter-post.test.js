import { describe, it, expect } from 'vitest';
import { letterPricePence, letterCostPence, letterPriceBreakdown, royalMailTrackingUrl, MAX_SHEETS } from '../letter-post.js';

describe('tracked letter price', () => {
  it('one sheet costs £3.32 and each extra sheet adds 6p', () => {
    expect(letterPricePence(1)).toBe(332);
    expect(letterPricePence(7)).toBe(368);   // the 7-page notice: £3.68
    expect(letterPricePence(9)).toBe(380);   // 7-page notice plus 2 drawings: £3.80
  });
  it('our own cost is 10p less than the price at every size', () => {
    for (const n of [1, 7, 9, 50]) expect(letterPricePence(n) - letterCostPence(n)).toBe(10);
  });
  it('adds VAT on top', () => {
    expect(letterPriceBreakdown(7)).toEqual({ net: 368, vat: 74, gross: 442 });
  });
  it('refuses nothing to post and anything over 50 sheets', () => {
    expect(() => letterPricePence(0)).toThrow();
    expect(() => letterPricePence(MAX_SHEETS + 1)).toThrow();
    expect(letterPricePence(MAX_SHEETS)).toBe(332 + 49 * 6);
  });
});

describe('tracking link', () => {
  it('fills the Royal Mail page in with the number', () => {
    expect(royalMailTrackingUrl('AB 123 456 789 GB')).toBe('https://www.royalmail.com/track-your-item#/tracking-results/AB123456789GB');
    expect(royalMailTrackingUrl('')).toBeNull();
  });
});
