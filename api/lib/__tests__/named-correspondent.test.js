import { describe, it, expect } from 'vitest';
import { findNamedCorrespondentAddresses, dedupeNearDuplicateEmails, formatRecipients, emailEvidenceHeader } from '../named-correspondent.js';
import { parseBookingIntent, extractEmailSenderFromPrompt } from '../../ely-smart.js';

const REAL_PROMPT = "discuss the last email from John Kelly I want to then look at all the correspondence between myself and John Kelly the amount of time to be gonna ask him for access the lack of response from him the amount of times I've emailed and he's not responded I want to create a like a pattern of a ten of events that then I can respond to that most recent email from him because I feel that actually is outrageous we've been for months already waiting to get this in place and I don't remember how long";

describe('named correspondent matching', () => {
  const people = [
    { sender_name: 'John Kelly', sender_email: 'john@kellyassociates.uk' },
    { sender_name: 'John Kelly', sender_email: 'john@kellyassociates.uk' },
    { sender_name: 'Sharon Snell', sender_email: 'sharon@bbailey.example' },
    { sender_name: 'Marie', sender_email: 'marie@example.com' },
  ];
  it('finds John Kelly from the real dictated prompt, and only him', () => {
    expect(findNamedCorrespondentAddresses(REAL_PROMPT, people)).toEqual(['john@kellyassociates.uk']);
  });
  it('does not match on single first names or partial words', () => {
    expect(findNamedCorrespondentAddresses('what did Marie say about johnny kellyman', people)).toEqual([]);
  });
});

describe('sender extraction no longer swallows the rest of a dictated sentence', () => {
  it('stops at the end of the name', () => {
    expect(extractEmailSenderFromPrompt(REAL_PROMPT)).toBe('John Kelly');
  });
});

describe('booking misfire', () => {
  it('the real prompt is no longer read as a booking with a project address', () => {
    const b = parseBookingIntent(REAL_PROMPT);
    expect(!b || (!b.rawDate && !b.rawProject)).toBe(true);
  });
  it('a genuine booking with an address still works', () => {
    const b = parseBookingIntent('book a site visit at 69 Kettlebaston Road on 15 October 2026');
    expect(b.rawProject).toMatch(/69 Kettlebaston Road/);
    expect(b.rawDate).toMatch(/15 October/);
  });
});

describe('duplicates and evidence headers', () => {
  it('collapses the same outgoing email stored twice a second apart, keeps a later chaser', () => {
    const rows = [
      { id: 1, direction: 'outgoing', subject: 'Re: X', body: '<p>Hi John, further to my email</p>', received_at: '2026-09-14T08:06:22Z' },
      { id: 2, direction: 'outgoing', subject: 'Re: X', body: '<p>Hi John, further to my email</p>', received_at: '2026-09-14T08:06:23Z' },
      { id: 3, direction: 'outgoing', subject: 'Re: X', body: '<p>Hi John, further to my email</p>', received_at: '2026-09-18T16:00:00Z' },
    ];
    expect(dedupeNearDuplicateEmails(rows).map((r) => r.id)).toEqual([1, 3]);
  });
  it('formats recipients from jsonb or plain text', () => {
    expect(formatRecipients([{ name: 'a@b.c', email: 'a@b.c' }], null)).toBe('a@b.c');
    expect(formatRecipients(null, 'x@y.z')).toBe('x@y.z');
  });
  it('header carries date, sender and direction', () => {
    const h = emailEvidenceHeader({ date: '2026-09-14T08:33:44Z', from: 'John Kelly', subject: 'S', direction: 'incoming' });
    expect(h).toContain('Date: 2026-09-14');
    expect(h).toContain('From: John Kelly');
    expect(h).toContain('Direction: incoming');
  });
});
