import { describe, it, expect } from 'vitest';
import { sendersOf, blockRowsFor, canBlockDomain } from '../senderBlock';

const emails = [
  { id: 1, sender_email: 'News@LinkedIn.com', user_id: 'u1', direction: 'incoming' },
  { id: 2, sender_email: 'news@linkedin.com', user_id: 'u1', direction: 'incoming' },
  { id: 3, sender_email: 'someone@gmail.com', user_id: 'u1', direction: 'incoming' },
  { id: 4, sender_email: 'me@mine.co.uk', user_id: 'u1', direction: 'outgoing' },
];

describe('sender block helpers', () => {
  it('lists each incoming sender once and ignores your own sent mail', () => {
    expect(sendersOf(emails).map(s => s.address)).toEqual(['news@linkedin.com', 'someone@gmail.com']);
  });
  it('sender mode saves exact addresses', () => {
    expect(blockRowsFor(sendersOf(emails), 'sender')).toEqual([
      { user_id: 'u1', kind: 'email', value: 'news@linkedin.com' },
      { user_id: 'u1', kind: 'email', value: 'someone@gmail.com' },
    ]);
  });
  it('domain mode blocks whole domains but falls back to the address for shared mailboxes', () => {
    expect(blockRowsFor(sendersOf(emails), 'domain')).toEqual([
      { user_id: 'u1', kind: 'domain', value: 'linkedin.com' },
      { user_id: 'u1', kind: 'email', value: 'someone@gmail.com' },
    ]);
    expect(canBlockDomain('x@gmail.com')).toBe(false);
  });
});
