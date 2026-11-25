import { describe, it, expect } from 'vitest';
import { noticeFileName, noticeFileBase, parseAddress } from '../noticeFileName';

const bo = '7 Village Close, Belsize Lane, London NW3 5AH';
const ao = '8 Village Close, Belsize Lane, London NW3 5AH';

describe('noticeFileName', () => {
  it('same street: numbers, street once, postcode once', () => {
    expect(noticeFileName(bo, ao, '', 'Notice_Pack')).toBe('7_8_Village_Close_NW3_5AH_Notice_Pack.pdf');
    expect(noticeFileName(bo, ao, '', '10_4b_Appointment')).toBe('7_8_Village_Close_NW3_5AH_10_4b_Appointment.pdf');
  });
  it('different streets: both shown, one postcode', () => {
    expect(noticeFileBase('12 Elm Road, London N1 2AB', '14a Oak Avenue, London N1 3CD')).toBe('12_Elm_Road_14a_Oak_Avenue_N1_2AB');
  });
  it('never has double underscores or odd characters', () => {
    const n = noticeFileName("7 St. Mary's Close,, London NW3  5AH", '8 St. Mary\'s Close, London NW3 5AH', '');
    expect(n).not.toMatch(/__/);
    expect(n).toMatch(/^[A-Za-z0-9._-]+$/);
  });
  it('falls back sensibly when an address cannot be read', () => {
    expect(noticeFileName('', '', 'Mr Smith')).toBe('Notice_Mr_Smith_Notice_Pack.pdf');
    expect(noticeFileBase('The Old Mill, Fenny Lane, Leeds LS1 1AA', 'Flat 2, 5 High Street, Leeds LS1 1AA')).toBe('The_Old_Mill_5_High_Street_LS1_1AA');
  });
  it('reads house numbers, ranges and postcodes', () => {
    expect(parseAddress('7a Village Close, London NW3 5AH')).toMatchObject({ number: '7a', street: 'Village Close', postcode: 'NW3 5AH' });
    expect(parseAddress('7-9 Village Close, London nw35ah').postcode).toBe('NW3 5AH');
  });
});
