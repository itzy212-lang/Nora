import { describe, it, expect } from 'vitest';
import {
  computeSendEligibility,
  computeSameDayBackAndForth,
  computeSilenceFallback,
  pickJitenJokeLine,
  JITTEN_EMAIL,
  JITTEN_JOKE_LINES,
  JITTEN_JOKE_ENABLED,
  JITTEN_ONE_OFF_ENABLED,
  JITTEN_ONE_OFF_LINE,
  JITTEN_ONE_OFF_MARKER,
} from '../../cron-auto-draft.js';

// Minimal chainable mock of the subset of the Supabase query builder
// this code actually calls (.select/.eq/.neq/.lte/.gte/.order/.limit/
// .not/.in/.or/.maybeSingle/.single, plus awaiting the chain
// directly). Responses are consumed FIFO per table, so a test can
// queue up different canned results for successive queries against
// the same table (e.g. 'tasks' being queried for holiday, then SOC,
// then other-meeting types in a single computeSendEligibility call).
function makeMockSupabase(responses) {
  const cursors = {};
  function next(table) {
    const queue = responses[table] || [];
    const idx = cursors[table] || 0;
    cursors[table] = idx + 1;
    return Promise.resolve(queue[idx] || { data: [], error: null });
  }
  function builder(table) {
    const b = {
      select() { return b; },
      eq() { return b; },
      neq() { return b; },
      lte() { return b; },
      gte() { return b; },
      order() { return b; },
      limit() { return b; },
      not() { return b; },
      in() { return b; },
      or() { return b; },
      maybeSingle() { return next(table); },
      single() { return next(table); },
      then(onFulfilled, onRejected) { return next(table).then(onFulfilled, onRejected); },
    };
    return b;
  }
  return { from: builder };
}

describe('cron-auto-draft eligibility — read gate', () => {
  it('an email Itzik has already opened is never eligible, regardless of anything else', async () => {
    const supabase = makeMockSupabase({});
    const result = await computeSendEligibility(
      { is_read: true, thread_id: 'thread-1' },
      supabase,
      'owner-1'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('read');
  });

  it('an unread email is not blocked by the read gate itself', async () => {
    // No ownerUserId -> falls through to the silence fallback, which
    // with no thread_id returns ineligible for its own separate
    // reason - proves the read gate itself didn't fire.
    const supabase = makeMockSupabase({});
    const result = await computeSendEligibility(
      { is_read: false, thread_id: null },
      supabase,
      null
    );
    expect(result.reason).toBe('silence');
  });
});

describe('computeSameDayBackAndForth', () => {
  const todayStr = '2026-09-28';

  it('is true when the thread has both an incoming and an outgoing message today', async () => {
    const supabase = makeMockSupabase({
      emails: [{
        data: [
          { direction: 'incoming', received_at: '2026-09-28T09:00:00Z' },
          { direction: 'outgoing', is_sent: true, sent_at: '2026-09-28T10:00:00Z' },
        ],
        error: null,
      }],
    });
    const result = await computeSameDayBackAndForth({ thread_id: 't1' }, supabase, todayStr);
    expect(result).toBe(true);
  });

  it('is false when only the incoming side happened today (no reply sent today)', async () => {
    const supabase = makeMockSupabase({
      emails: [{
        data: [
          { direction: 'incoming', received_at: '2026-09-28T09:00:00Z' },
          { direction: 'outgoing', is_sent: true, sent_at: '2026-09-27T10:00:00Z' },
        ],
        error: null,
      }],
    });
    const result = await computeSameDayBackAndForth({ thread_id: 't1' }, supabase, todayStr);
    expect(result).toBe(false);
  });

  it('is false with no thread_id at all', async () => {
    const supabase = makeMockSupabase({});
    const result = await computeSameDayBackAndForth({ thread_id: null }, supabase, todayStr);
    expect(result).toBe(false);
  });
});

describe('computeSilenceFallback — one-hour threshold', () => {
  it('is not yet eligible just under an hour after the email arrived', async () => {
    const receivedAt = new Date(Date.now() - 59 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({ emails: [{ data: null, error: null }] });
    const result = await computeSilenceFallback({ thread_id: 't1', received_at: receivedAt }, supabase);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('silence');
  });

  it('is eligible once a full hour has passed since the email arrived', async () => {
    const receivedAt = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({ emails: [{ data: null, error: null }] });
    const result = await computeSilenceFallback({ thread_id: 't1', received_at: receivedAt }, supabase);
    expect(result.eligible).toBe(true);
  });

  it('is ineligible with no thread_id at all', async () => {
    const supabase = makeMockSupabase({});
    const result = await computeSilenceFallback({ thread_id: null, received_at: new Date().toISOString() }, supabase);
    expect(result.eligible).toBe(false);
  });
});

describe('pickJitenJokeLine', () => {
  it('always returns one of the approved joke lines', () => {
    for (const seed of ['a', 'email-id-123', 'another-id', '', 'z']) {
      expect(JITTEN_JOKE_LINES).toContain(pickJitenJokeLine(seed));
    }
  });

  it('is deterministic for the same seed', () => {
    expect(pickJitenJokeLine('same-email-id')).toBe(pickJitenJokeLine('same-email-id'));
  });

  it('JITTEN_EMAIL is the expected contact', () => {
    expect(JITTEN_EMAIL).toBe('jiten@jpw-arc.co.uk');
  });

  it('none of the ongoing joke lines claim a long-running history', () => {
    // On request, 2026-09-28: "it's not been years, it's just a
    // recent thing" - regression guard against that phrasing
    // creeping back in.
    for (const line of JITTEN_JOKE_LINES) {
      expect(line.toLowerCase()).not.toMatch(/over the years/);
    }
  });
});

describe('Jiten one-off - current configuration', () => {
  it('the ongoing varying joke is paused while the one-off is live', () => {
    expect(JITTEN_JOKE_ENABLED).toBe(false);
  });

  it('the one-off is enabled and has the exact requested wording', () => {
    expect(JITTEN_ONE_OFF_ENABLED).toBe(true);
    expect(JITTEN_ONE_OFF_LINE).toBe(
      "A little birdie told me that you're not my biggest fan - that being said, I just thought I'd let you know that he's in a meeting and will get back to you shortly."
    );
  });

  it('has a distinct marker so it can be detected as already-used and never fires twice', () => {
    expect(JITTEN_ONE_OFF_MARKER).toBe('cron-auto-draft-jiten-oneoff');
  });
});
