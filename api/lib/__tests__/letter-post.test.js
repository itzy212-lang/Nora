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

import { splitUkPostcode, costToPence } from '../letter-post.js';
import { buildPrintForm } from '../intelliprint.js';

describe('address and cost helpers', () => {
  it('splits a UK postcode off the end of an address', () => {
    expect(splitUkPostcode('12 High Street, London N1 2AB')).toEqual({ line: '12 High Street, London', postcode: 'N1 2AB' });
    expect(splitUkPostcode('1 Nether Street, London, n12 8ez')).toEqual({ line: '1 Nether Street, London', postcode: 'N12 8EZ' });
    expect(splitUkPostcode('Flat 2, 5 Park Rd, SW1A1AA')).toEqual({ line: 'Flat 2, 5 Park Rd', postcode: 'SW1A 1AA' });
    expect(splitUkPostcode('No postcode here')).toEqual({ line: 'No postcode here', postcode: '' });
  });
  it('turns Intelliprint cost amounts (pounds x 10^8) into pence', () => {
    expect(costToPence({ amount: 322000000 })).toBe(322);
    expect(costToPence({ amount: 358000000 })).toBe(358);
    expect(costToPence(null)).toBeNull();
  });
});

describe('print request', () => {
  const base = { pdfB64: 'JVBERi0=', name: 'Mr A Owner', line: '12 High Street, London', postcode: 'N1 2AB' };
  it('asks for a tracked, single-sided letter and stays in test mode unless live', () => {
    const f = buildPrintForm(base);
    expect(f.get('postage[service]')).toBe('tracked_48');
    expect(f.get('printing[double_sided]')).toBe('no');
    expect(f.get('recipients[0][address][postcode]')).toBe('N1 2AB');
    expect(f.get('testmode')).toBe('true');
    expect(f.get('confirmed')).toBe('true');
    expect(buildPrintForm({ ...base, live: true }).get('testmode')).toBe('false');
  });
});

import { letterStatusLabel } from '../letter-post.js';
describe('letter status label', () => {
  it('turns provider statuses into plain English and stops asking once final', () => {
    expect(letterStatusLabel('printed').label).toBe('Printed');
    expect(letterStatusLabel('posted')).toEqual({ label: 'Posted', final: false });
    expect(letterStatusLabel('delivered')).toEqual({ label: 'Delivered', final: true });
    expect(letterStatusLabel('rejected').label).toBe('Not accepted');
    expect(letterStatusLabel('on_hold').label).toBe('on_hold');
  });
});

import { noticeSectionsLabel, noticeDeliveryInfo } from '../notice-activity.js';
describe('served notice list', () => {
  it('names the sections a notice covered', () => {
    expect(noticeSectionsLabel({ section_6: true })).toBe('Section 6(1)');
    expect(noticeSectionsLabel({ section_6: true, section_1: true, section_2: true, section_2_subsections: 'a' })).toBe('Sections 6(1), 1(5) and 2(2)(a)');
    expect(noticeSectionsLabel({ section_10: true, section_1: true })).toBe('Section 10 notice');
    expect(noticeSectionsLabel({})).toBe('Notice');
  });
  it('describes how each notice went out', () => {
    expect(noticeDeliveryInfo({ delivery_method: 'emailed' }).text).toBe('Emailed');
    expect(noticeDeliveryInfo({}).text).toBe('');
    const posted = noticeDeliveryInfo({ delivery_method: 'posted' }, { status: 'sent', tracking_number: 'AB 12 GB', testmode: false });
    expect(posted.trackingUrl).toContain('AB12GB');
    expect(noticeDeliveryInfo({ delivery_method: 'posted' }, { testmode: true }).text).toMatch(/Test letter/);
  });
});
