import { describe, it, expect } from 'vitest';
import { isBlockedSender, canBlockDomain, isOtherFromOutlook, isOtherFromGmailLabels, containsWholePhrase } from '../email-filters.js';

describe('blocked senders', () => {
  const rows = [{ kind: 'email', value: 'Jobs@Bark.com' }, { kind: 'domain', value: 'linkedin.com' }];
  it('blocks an exact address, ignoring case', () => {
    expect(isBlockedSender(rows, 'jobs@bark.com')).toBe(true);
    expect(isBlockedSender(rows, 'other@bark.com')).toBe(false);
  });
  it('a domain rule covers the domain and its sub-domains, nothing else', () => {
    expect(isBlockedSender(rows, 'messages-noreply@linkedin.com')).toBe(true);
    expect(isBlockedSender(rows, 'x@e.linkedin.com')).toBe(true);
    expect(isBlockedSender(rows, 'x@notlinkedin.com')).toBe(false);
  });
  it('never blocks a whole shared-mailbox domain, even if a rule somehow exists', () => {
    expect(canBlockDomain('someone@gmail.com')).toBe(false);
    expect(canBlockDomain('sales@voipfone.co.uk')).toBe(true);
    expect(isBlockedSender([{ kind: 'domain', value: 'gmail.com' }], 'client@gmail.com')).toBe(false);
  });
  it('handles empty input', () => {
    expect(isBlockedSender([], 'a@b.com')).toBe(false);
    expect(isBlockedSender(rows, '')).toBe(false);
  });
});

describe('others folder', () => {
  it('Outlook: only "other" is filed away', () => {
    expect(isOtherFromOutlook('other')).toBe(true);
    expect(isOtherFromOutlook('Other')).toBe(true);
    expect(isOtherFromOutlook('focused')).toBe(false);
    expect(isOtherFromOutlook(undefined)).toBe(false);
  });
  it('Gmail: promotions, social and forums are filed away; updates and primary are not', () => {
    expect(isOtherFromGmailLabels(['INBOX', 'CATEGORY_PROMOTIONS'])).toBe(true);
    expect(isOtherFromGmailLabels(['CATEGORY_SOCIAL'])).toBe(true);
    expect(isOtherFromGmailLabels(['INBOX', 'CATEGORY_UPDATES'])).toBe(false);
    expect(isOtherFromGmailLabels(['INBOX', 'CATEGORY_PERSONAL'])).toBe(false);
    expect(isOtherFromGmailLabels(undefined)).toBe(false);
  });
});

describe('whole phrase match', () => {
  it('does not match inside a longer number (the Voipfone case)', () => {
    expect(containsWholePhrase('Invoice To: Itzik Darel 121 Nether Street', '1 Nether Street')).toBe(false);
    expect(containsWholePhrase('Notice for 1 Nether Street, London', '1 Nether Street')).toBe(true);
    expect(containsWholePhrase('SQ1-2026-466', 'sq1-2026-466')).toBe(true);
  });
});
