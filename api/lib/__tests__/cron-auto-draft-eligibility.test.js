import { describe, it, expect } from 'vitest';
import {
  isWithinTimedEntry,
  realFinishTime,
  collectProjectPartyEmails,
  isSenderKnownToProject,
  senderIsKnownPartyOfProject,
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

// Added 2026-10-01, on request: a thread with genuine same-day
// back-and-forth means Itzik is actively engaged and likely to reply
// himself soon, so it gets a longer 2-hour grace period rather than
// the ordinary 1-hour default used for a thread with no current
// engagement.
describe('computeSilenceFallback — two-hour threshold for an active same-day thread', () => {
  it('does NOT fire at the ordinary one-hour mark when sameDayBackAndForth is true', async () => {
    const receivedAt = new Date(Date.now() - 75 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({ emails: [{ data: null, error: null }] });
    const result = await computeSilenceFallback({ thread_id: 't1', received_at: receivedAt }, supabase, true);
    expect(result.eligible).toBe(false);
  });

  it('is not yet eligible just under two hours in when sameDayBackAndForth is true', async () => {
    const receivedAt = new Date(Date.now() - 119 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({ emails: [{ data: null, error: null }] });
    const result = await computeSilenceFallback({ thread_id: 't1', received_at: receivedAt }, supabase, true);
    expect(result.eligible).toBe(false);
  });

  it('is eligible once a full two hours has passed when sameDayBackAndForth is true', async () => {
    const receivedAt = new Date(Date.now() - 121 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({ emails: [{ data: null, error: null }] });
    const result = await computeSilenceFallback({ thread_id: 't1', received_at: receivedAt }, supabase, true);
    expect(result.eligible).toBe(true);
  });

  it('still uses the ordinary one-hour threshold when sameDayBackAndForth is false/omitted', async () => {
    const receivedAt = new Date(Date.now() - 75 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase({ emails: [{ data: null, error: null }] });
    const result = await computeSilenceFallback({ thread_id: 't1', received_at: receivedAt }, supabase, false);
    expect(result.eligible).toBe(true);
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

// Added 2026-10-08 - regression coverage for the real incident: a new
// enquirer's emails were filed under an unrelated client's project (by
// identical subject line), and Nora auto-sent her that client's
// confidential appointment details. The send gate must hold no matter
// HOW the email came to be filed there.
describe('cron-auto-draft — sender must be a recorded party on the linked project', () => {
  const silvermere = {
    bo_1_email: 'aykut_ozparlak@hotmail.co.uk',
    bo_2_email: null,
    ao_email: null,
    bos_email: 'bos@example.com',
    client_email: '',
    aos: [{ email: 'AO@Example.com', surv_email: 'surveyor@firm.co.uk' }],
  };
  const aoRows = [{ email: 'dawn@example.com', email2: null, surveyor_email: 'jiten@jpw-arc.co.uk', third_surveyor_email: 'third@x.com' }];

  it('the real incident: a stranger filed under an unrelated project is NOT a known party', () => {
    expect(isSenderKnownToProject('nichole.p.matthews@gmail.com', silvermere, aoRows)).toBe(false);
  });

  it('recognises owners, adjoining owners and surveyors on both sides, case-insensitively', () => {
    expect(isSenderKnownToProject('Aykut_Ozparlak@Hotmail.co.uk', silvermere, aoRows)).toBe(true);
    expect(isSenderKnownToProject('ao@example.com', silvermere, aoRows)).toBe(true);
    expect(isSenderKnownToProject('surveyor@firm.co.uk', silvermere, aoRows)).toBe(true);
    expect(isSenderKnownToProject('jiten@jpw-arc.co.uk', silvermere, aoRows)).toBe(true);
    expect(isSenderKnownToProject('third@x.com', silvermere, aoRows)).toBe(true);
    expect(isSenderKnownToProject('  bos@example.com ', silvermere, aoRows)).toBe(true);
  });

  it('fails closed on missing or malformed input — never an assumed yes', () => {
    expect(isSenderKnownToProject('', silvermere, aoRows)).toBe(false);
    expect(isSenderKnownToProject(null, silvermere, aoRows)).toBe(false);
    expect(isSenderKnownToProject('a@b.com', null, aoRows)).toBe(false);
    expect(isSenderKnownToProject('a@b.com', {}, null)).toBe(false);
    expect(collectProjectPartyEmails({ aos: 'not json' }, [null]).size).toBe(0);
  });

  it('reads aos stored as a JSON string as well as an array', () => {
    const asString = { aos: JSON.stringify([{ email: 'x@y.com' }]) };
    expect(isSenderKnownToProject('x@y.com', asString, [])).toBe(true);
  });

  it('senderIsKnownPartyOfProject: false with no project link or no sender, without querying', async () => {
    const supabase = makeMockSupabase({});
    expect(await senderIsKnownPartyOfProject({ project_id: null, sender_email: 'a@b.com' }, supabase)).toBe(false);
    expect(await senderIsKnownPartyOfProject({ project_id: 'p1', sender_email: null }, supabase)).toBe(false);
  });

  it('senderIsKnownPartyOfProject: reads the project and its adjoining owners', async () => {
    const supabase = makeMockSupabase({
      projects: [{ data: silvermere, error: null }],
      adjoining_owners: [{ data: aoRows, error: null }],
    });
    expect(await senderIsKnownPartyOfProject({ project_id: 'p1', sender_email: 'dawn@example.com' }, supabase)).toBe(true);
    const supabase2 = makeMockSupabase({
      projects: [{ data: silvermere, error: null }],
      adjoining_owners: [{ data: aoRows, error: null }],
    });
    expect(await senderIsKnownPartyOfProject({ project_id: 'p1', sender_email: 'nichole.p.matthews@gmail.com' }, supabase2)).toBe(false);
  });
});


describe('manual no-reply switch and timed diary entries', () => {
  it('never replies when the email has the no-reply switch on (before any other check)', async () => {
    const r = await computeSendEligibility({ id: 'e1', is_read: false, nora_no_reply: true, project_id: 'p1' }, {}, 'u1');
    expect(r).toMatchObject({ eligible: false, reason: 'muted' });
  });
  it('never replies to an email that has been opened', async () => {
    const r = await computeSendEligibility({ id: 'e1', is_read: true, project_id: 'p1' }, {}, 'u1');
    expect(r).toMatchObject({ eligible: false, reason: 'read' });
  });
  it('uses the real finish time of a meeting when one is set', () => {
    const t = { time: '10:00', end_time: '13:00' };
    expect(isWithinTimedEntry(t, 12 * 60 + 30)).toBe(true);   // 12:30, inside a 3h meeting
    expect(isWithinTimedEntry(t, 13 * 60 + 1)).toBe(false);   // just after
    expect(isWithinTimedEntry(t, 9 * 60 + 59)).toBe(false);   // just before
  });
  it('falls back to one hour when there is no (or a nonsense) finish time', () => {
    expect(isWithinTimedEntry({ time: '10:00' }, 10 * 60 + 59)).toBe(true);
    expect(isWithinTimedEntry({ time: '10:00' }, 11 * 60 + 1)).toBe(false);
    expect(isWithinTimedEntry({ time: '10:00', end_time: '09:00' }, 10 * 60 + 30)).toBe(true);
    expect(isWithinTimedEntry({ time: '10:00', end_time: '09:00' }, 11 * 60 + 30)).toBe(false);
    expect(isWithinTimedEntry({ time: '' }, 600)).toBe(false);
  });
});

describe('real finish time for non-SOC diary entries', () => {
  it('returns the finish time for meetings, calls, site visits and appointments', () => {
    expect(realFinishTime({ task_type: 'meeting', time: '10:00', end_time: '13:00' })).toBe('13:00');
    expect(realFinishTime({ task_type: 'call', time: '09:30', end_time: '10:15:00' })).toBe('10:15');
  });
  it('never uses a finish time for Schedules of Condition', () => {
    expect(realFinishTime({ task_type: 'soc', time: '10:00', end_time: '13:00' })).toBeNull();
  });
  it('ignores missing or nonsensical finish times', () => {
    expect(realFinishTime({ task_type: 'meeting', time: '10:00' })).toBeNull();
    expect(realFinishTime({ task_type: 'meeting', time: '10:00', end_time: '09:00' })).toBeNull();
    expect(realFinishTime({ task_type: 'meeting', end_time: '09:00' })).toBeNull();
  });
});

import { latestPersonalMessageTime, normaliseSubjectForConversation, isSameConversation } from '../../cron-auto-draft.js';

describe('conversation matching (Outlook gives each reply a new thread id)', () => {
  it('strips Re:/Fwd: prefixes', () => {
    expect(normaliseSubjectForConversation('Re: Re: RE: Flat D, 16 Wetherby Place')).toBe('flat d, 16 wetherby place');
    expect(normaliseSubjectForConversation('FW: Re: X')).toBe('x');
  });
  it('treats Adeel Raza\'s two emails as one conversation despite different thread ids', () => {
    const a = { thread_id: 'AAA', project_id: 'p1', subject: 'Re: Flat D, 16 Wetherby Place, London, SW7 4ND' };
    const b = { thread_id: 'BBB', project_id: 'p1', subject: 'Re: Re: Re: Flat D, 16 Wetherby Place, London, SW7 4ND' };
    expect(isSameConversation(a, b)).toBe(true);
  });
  it('keeps a different subject, or a different project, as a new conversation', () => {
    const a = { thread_id: 'AAA', project_id: 'p1', subject: 'Re: Flat D' };
    expect(isSameConversation(a, { thread_id: 'BBB', project_id: 'p1', subject: 'Invoice 1671' })).toBe(false);
    expect(isSameConversation(a, { thread_id: 'CCC', project_id: 'p2', subject: 'Flat D' })).toBe(false);
  });
});

describe('personal-contact hold-off: Itzik\'s own messages vs Nora\'s', () => {
  const t = (s) => '2026-10-15T' + s + 'Z';
  it('finds Itzik\'s own email to the sender', () => {
    const out = [{ sent_at: t('10:25:04') }];
    expect(latestPersonalMessageTime(out, [])).toBe(new Date(t('10:25:04')).getTime());
  });
  it('ignores rows that line up with a reply Nora herself sent', () => {
    const out = [{ sent_at: t('10:46:01') }, { sent_at: t('10:46:02') }];
    const drafts = [{ created_at: t('10:45:57'), updated_at: t('10:45:58') }];
    expect(latestPersonalMessageTime(out, drafts)).toBeNull();
  });
  it('still finds Itzik\'s email when Nora also replied earlier', () => {
    const out = [{ sent_at: t('10:25:04') }, { sent_at: t('10:46:01') }];
    const drafts = [{ created_at: t('10:45:57'), updated_at: t('10:45:58') }];
    expect(latestPersonalMessageTime(out, drafts)).toBe(new Date(t('10:25:04')).getTime());
  });
});

import { hasWaitedLongEnough, ANSWERED_CONVERSATION_WAIT_MINUTES } from '../../cron-auto-draft.js';

describe('wait before answering a conversation Nora has already answered', () => {
  const received = '2026-10-15T10:50:15Z';
  const at = (hhmm) => new Date('2026-10-15T' + hhmm + ':00Z').getTime();
  it('waits 3 hours', () => {
    expect(ANSWERED_CONVERSATION_WAIT_MINUTES).toBe(180);
    expect(hasWaitedLongEnough(received, at('11:20'), 180)).toBe(false);   // 30 min: Adeel's 12:16 reply case
    expect(hasWaitedLongEnough(received, at('13:49'), 180)).toBe(false);
    expect(hasWaitedLongEnough(received, at('13:51'), 180)).toBe(true);
  });
  it('never treats a missing date as waited', () => {
    expect(hasWaitedLongEnough(null, Date.now(), 180)).toBe(false);
  });
});

import { isReplyToPersonalMessage } from '../../cron-auto-draft.js';

describe('an email that answers something Itzik personally sent is his, not Nora\'s', () => {
  const itzik = new Date('2026-10-15T13:19:43Z').getTime();
  it('Marie Burak case: her 13:23 answer to his 13:19 question is not answered by Nora', () => {
    expect(isReplyToPersonalMessage('2026-10-15T13:23:24Z', itzik)).toBe(true);
  });
  it('still blocked a day later, but not after the 72-hour window', () => {
    expect(isReplyToPersonalMessage('2026-10-16T13:00:00Z', itzik)).toBe(true);
    expect(isReplyToPersonalMessage('2026-10-19T13:00:00Z', itzik)).toBe(false);
  });
  it('an email that arrived BEFORE his message is not a reply to it', () => {
    expect(isReplyToPersonalMessage('2026-10-15T13:00:00Z', itzik)).toBe(false);
  });
  it('no personal message means no block', () => {
    expect(isReplyToPersonalMessage('2026-10-15T13:23:24Z', null)).toBe(false);
  });
});
