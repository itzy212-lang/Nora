import { describe, it, expect } from 'vitest';
import {
  computeSendEligibility,
  computeSameDayBackAndForth,
  computeSilenceFallback,
  findSameAppointmentMatch,
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
    // reason - proves the read gate itself didn't fire. Needs a
    // project_id so the no_project gate (below) doesn't intercept it
    // first and mask what this test is actually checking.
    const supabase = makeMockSupabase({});
    const result = await computeSendEligibility(
      { is_read: false, thread_id: null, project_id: 'proj-1' },
      supabase,
      null
    );
    expect(result.reason).toBe('silence');
  });
});

describe('cron-auto-draft eligibility — no-project gate', () => {
  // Added 2026-09-30, after a real miss: an automated Supabase billing
  // receipt (invoice+statements@supabase.com) - not tied to any
  // project - got a full "Dear Supabase Team ... On behalf of Itzik
  // Darel" auto-reply. SKIP_SENDERS is a blocklist of known patterns
  // and missed this address entirely; the classifier labelled it
  // "business" (true, but not the same as "needs a reply"). An email
  // with no project_id at all isn't tied to any party-wall matter, so
  // it should never be eligible for an automated reply - a hard,
  // deterministic rule rather than one more pattern to keep adding to.

  it('is never eligible when the email has no project_id, regardless of anything else', async () => {
    const supabase = makeMockSupabase({});
    const result = await computeSendEligibility(
      { is_read: false, thread_id: 'thread-1', project_id: null },
      supabase,
      'owner-1'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no_project');
  });

  it('also fires with project_id simply absent (undefined), not just explicit null', async () => {
    const supabase = makeMockSupabase({});
    const result = await computeSendEligibility(
      { is_read: false, thread_id: 'thread-1' },
      supabase,
      'owner-1'
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no_project');
  });

  it('takes priority over the silence fallback (would otherwise be eligible)', async () => {
    const receivedAt = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({ emails: [{ data: null, error: null }] });
    const result = await computeSendEligibility(
      { is_read: false, thread_id: 'thread-1', project_id: '', received_at: receivedAt },
      supabase,
      null
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no_project');
  });

  it('does not block an otherwise-eligible email that does have a project_id', async () => {
    const supabase = makeMockSupabase({});
    const result = await computeSendEligibility(
      { is_read: false, thread_id: null, project_id: 'proj-1' },
      supabase,
      null
    );
    expect(result.reason).not.toBe('no_project');
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

describe('findSameAppointmentMatch', () => {
  // Reported 2026-09-29: Nora told the occupant of that day's SOC
  // property "he has site appointments booked this morning", which
  // looked odd since they already knew why he was unavailable. These
  // tests cover the matching rule that lets the framing instead say
  // "he's on his way to you / on site with you" - safely, without
  // ever telling the WRONG leaseholder in a multi-AO building that
  // Itzik is at their door.

  it('matches on project alone when the project has a single AO on file', async () => {
    const email = { project_id: 'proj-1', sender_email: 'someone-not-on-file@example.com' };
    const socEntries = [{ startMin: 600, project_id: 'proj-1', ao_id: 'ao-1' }];
    const supabase = makeMockSupabase({
      adjoining_owners: [{ data: [{ id: 'ao-1', email: '', email2: '' }], error: null }],
    });
    const result = await findSameAppointmentMatch(email, socEntries, supabase);
    expect(result).toEqual(socEntries[0]);
  });

  it('with multiple AOs on the project, matches only the AO whose email matches the sender', async () => {
    const email = { project_id: 'proj-1', sender_email: 'flat3@example.com' };
    const socEntries = [
      { startMin: 600, project_id: 'proj-1', ao_id: 'ao-flat-3' },
    ];
    const supabase = makeMockSupabase({
      adjoining_owners: [{
        data: [
          { id: 'ao-flat-3', email: 'Flat3@Example.com', email2: '' },
          { id: 'ao-flat-7', email: 'flat7@example.com', email2: '' },
        ],
        error: null,
      }],
    });
    const result = await findSameAppointmentMatch(email, socEntries, supabase);
    expect(result).toEqual(socEntries[0]);
  });

  it('also checks the AO email2 field', async () => {
    const email = { project_id: 'proj-1', sender_email: 'secondary@example.com' };
    const socEntries = [{ startMin: 600, project_id: 'proj-1', ao_id: 'ao-1' }];
    const supabase = makeMockSupabase({
      adjoining_owners: [{
        data: [{ id: 'ao-1', email: 'primary@example.com', email2: 'secondary@example.com' }],
        error: null,
      }],
    });
    const result = await findSameAppointmentMatch(email, socEntries, supabase);
    expect(result).toEqual(socEntries[0]);
  });

  it('never matches a different leaseholder in the same multi-AO building', async () => {
    // The critical safety case: today's SOC is booked for flat 3, but
    // flat 7's tenant (also on this project) is the one emailing.
    // Must NOT say "he's on his way to you" to flat 7.
    const email = { project_id: 'proj-1', sender_email: 'flat7@example.com' };
    const socEntries = [{ startMin: 600, project_id: 'proj-1', ao_id: 'ao-flat-3' }];
    const supabase = makeMockSupabase({
      adjoining_owners: [{
        data: [
          { id: 'ao-flat-3', email: 'flat3@example.com', email2: '' },
          { id: 'ao-flat-7', email: 'flat7@example.com', email2: '' },
        ],
        error: null,
      }],
    });
    const result = await findSameAppointmentMatch(email, socEntries, supabase);
    expect(result).toBeNull();
  });

  it('returns null with multiple AOs when the sender email is not on file at all', async () => {
    const email = { project_id: 'proj-1', sender_email: 'unknown@example.com' };
    const socEntries = [{ startMin: 600, project_id: 'proj-1', ao_id: 'ao-flat-3' }];
    const supabase = makeMockSupabase({
      adjoining_owners: [{
        data: [
          { id: 'ao-flat-3', email: 'flat3@example.com', email2: '' },
          { id: 'ao-flat-7', email: 'flat7@example.com', email2: '' },
        ],
        error: null,
      }],
    });
    const result = await findSameAppointmentMatch(email, socEntries, supabase);
    expect(result).toBeNull();
  });

  it('returns null when the email has no project_id, without querying at all', async () => {
    const supabase = makeMockSupabase({});
    const result = await findSameAppointmentMatch({ project_id: null, sender_email: 'x@example.com' }, [], supabase);
    expect(result).toBeNull();
  });

  it("returns null when today's SOC tasks are all for a different project", async () => {
    const email = { project_id: 'proj-1', sender_email: 'someone@example.com' };
    const socEntries = [{ startMin: 600, project_id: 'proj-OTHER', ao_id: 'ao-1' }];
    const supabase = makeMockSupabase({});
    const result = await findSameAppointmentMatch(email, socEntries, supabase);
    expect(result).toBeNull();
  });
});

describe('computeSendEligibility - SOC same-property phrasing', () => {
  // End-to-end coverage of the phase-aware wording through
  // computeSendEligibility itself: "on his way" before the
  // appointment, "on site" during it, and - per explicit instruction -
  // never a "driving back" / "finished" claim in the tail travel
  // buffer after, since the appointment may have overrun.

  function socSetup({ nowOffsetFromStartMin, projectMatches = true }) {
    const startHour = new Date().getHours();
    // Build a start time relative to "now" using minutes-since-midnight
    // math so the test is independent of wall-clock time.
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = nowMin - nowOffsetFromStartMin;
    const hh = String(Math.floor(((startMin % 1440) + 1440) % 1440 / 60)).padStart(2, '0');
    const mm = String((((startMin % 1440) + 1440) % 1440) % 60).padStart(2, '0');
    return {
      time: `${hh}:${mm}`,
      project_id: projectMatches ? 'proj-1' : 'proj-OTHER',
      ao_id: 'ao-1',
    };
  }

  it('says "on his way" while still in the pre-appointment travel buffer', async () => {
    const task = socSetup({ nowOffsetFromStartMin: -20 }); // starts in 20 min
    const supabase = makeMockSupabase({
      tasks: [
        { data: [], error: null }, // holiday check
        { data: [task], error: null }, // soc check
      ],
      adjoining_owners: [{ data: [{ id: 'ao-1', email: '', email2: '' }], error: null }],
      emails: [{ data: [], error: null }], // same-day back-and-forth check
    });
    const result = await computeSendEligibility(
      { is_read: false, thread_id: 't1', project_id: 'proj-1', sender_email: 'occupant@example.com' },
      supabase,
      'owner-1'
    );
    expect(result.reason).toBe('soc');
    expect(result.framing.toLowerCase()).toContain('on his way');
  });

  it('says "on site" once the appointment is assumed under way', async () => {
    const task = socSetup({ nowOffsetFromStartMin: 30 }); // started 30 min ago
    const supabase = makeMockSupabase({
      tasks: [
        { data: [], error: null },
        { data: [task], error: null },
      ],
      adjoining_owners: [{ data: [{ id: 'ao-1', email: '', email2: '' }], error: null }],
      emails: [{ data: [], error: null }],
    });
    const result = await computeSendEligibility(
      { is_read: false, thread_id: 't1', project_id: 'proj-1', sender_email: 'occupant@example.com' },
      supabase,
      'owner-1'
    );
    expect(result.reason).toBe('soc');
    expect(result.framing.toLowerCase()).toContain('on site');
  });

  it('never claims he is driving back or finished in the tail travel buffer - falls back to the generic line', async () => {
    const task = socSetup({ nowOffsetFromStartMin: 110 }); // 90-min appointment ended 20 min ago
    const supabase = makeMockSupabase({
      tasks: [
        { data: [], error: null },
        { data: [task], error: null },
      ],
      adjoining_owners: [{ data: [{ id: 'ao-1', email: '', email2: '' }], error: null }],
      emails: [{ data: [], error: null }],
      firm_settings: [{ data: { business_hours: null }, error: null }],
    });
    const result = await computeSendEligibility(
      { is_read: false, thread_id: 't1', project_id: 'proj-1', sender_email: 'occupant@example.com' },
      supabase,
      'owner-1'
    );
    expect(result.reason).toBe('soc');
    expect(result.framing.toLowerCase()).not.toContain('driving back');
    expect(result.framing.toLowerCase()).not.toContain('finished');
    expect(result.framing.toLowerCase()).not.toContain('on his way');
    expect(result.framing.toLowerCase()).not.toContain('on site');
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
