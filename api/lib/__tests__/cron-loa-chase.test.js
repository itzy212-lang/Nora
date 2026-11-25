import { describe, it, expect } from 'vitest';
import { runLoaChase, activeMessage } from '../../cron-loa-chase.js';

// Tiny in-memory stand-in for the database calls the chaser makes.
function fakeDb(tables) {
  const q = (name) => {
    let rows = tables[name]; let patch = null; const filters = [];
    const api = {
      select: () => api,
      in: (c, v) => { filters.push((r) => v.includes(r[c])); return api; },
      is: (c, v) => { filters.push((r) => r[c] === v); return api; },
      lt: (c, v) => { filters.push((r) => r[c] != null && r[c] < v); return api; },
      eq: (c, v) => { filters.push((r) => r[c] === v); return api; },
      order: () => api,
      update: (p) => { patch = p; return api; },
      _run: () => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) hit.forEach((r) => Object.assign(r, patch));
        return hit;
      },
      maybeSingle: async () => ({ data: api._run()[0] || null, error: null }),
      then: (res) => res({ data: api._run(), error: null }),
    };
    return api;
  };
  return { from: q };
}

const NOW = new Date('2026-11-25T10:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const setup = (over = {}) => ({
  loa_signing_requests: [{ id: 'r1', user_id: 'u1', appointment_type: 'bo_loa', status: 'in_progress' }],
  loa_signers: [
    { id: 's1', request_id: 'r1', position: 1, name: 'Sam Jones', email: 'sam@example.com', status: 'invited', invited_at: daysAgo(4), chased_at: null, token_hash: 'old' },
    { id: 's2', request_id: 'r1', position: 2, name: 'Pat Jones', email: 'pat@example.com', status: 'waiting', invited_at: null, chased_at: null, token_hash: 'old2' },
  ],
  ...over,
});

describe('LOA chaser', () => {
  it('chases only the signer whose turn it is, with a fresh link; nothing goes to the one waiting', async () => {
    const t = setup(); const sent = [];
    const r = await runLoaChase(fakeDb(t), { now: NOW, send: async (m) => { sent.push(m); return { sent: true }; } });
    expect(r.chased).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['sam@example.com']);
    expect(sent[0].text).toMatch(/\/loa\/sign\/[A-Za-z0-9_-]{32}/);
    expect(t.loa_signers[0].token_hash).not.toBe('old');
    expect(t.loa_signers[0].chased_at).toBeTruthy();
    expect(t.loa_signers[1].chased_at).toBeNull();
  });
  it('the second signer is chased 3 days after THEIR invitation, not before', async () => {
    const t = setup();
    t.loa_signers[0].status = 'verified'; t.loa_signers[0].chased_at = daysAgo(2);
    t.loa_signers[1].status = 'invited'; t.loa_signers[1].invited_at = daysAgo(1);
    const sent = [];
    const send = async (m) => { sent.push(m); return { sent: true }; };
    expect((await runLoaChase(fakeDb(t), { now: NOW, send })).chased).toBe(0);
    t.loa_signers[1].invited_at = daysAgo(3.5);
    expect((await runLoaChase(fakeDb(t), { now: NOW, send })).chased).toBe(1);
    expect(sent[0].to).toEqual(['pat@example.com']);
  });
  it('a single owner gets a single email', async () => {
    const t = setup(); t.loa_signers = [t.loa_signers[0]]; const sent = [];
    await runLoaChase(fakeDb(t), { now: NOW, send: async (m) => { sent.push(m); return { sent: true }; } });
    expect(sent).toHaveLength(1);
  });
  it('does nothing before 3 days, after signing, once already chased, or when cancelled', async () => {
    const send = async () => { throw Error('should not send'); };
    const young = setup(); young.loa_signers[0].invited_at = daysAgo(2);
    expect((await runLoaChase(fakeDb(young), { now: NOW, send })).chased).toBe(0);
    const done = setup(); done.loa_signers[0].status = 'verified';
    expect((await runLoaChase(fakeDb(done), { now: NOW, send })).chased).toBe(0);
    const again = setup(); again.loa_signers[0].chased_at = daysAgo(1);
    expect((await runLoaChase(fakeDb(again), { now: NOW, send })).chased).toBe(0);
    const cancelled = setup({ loa_signing_requests: [{ id: 'r1', user_id: 'u1', appointment_type: 'bo_loa', status: 'cancelled' }] });
    expect((await runLoaChase(fakeDb(cancelled), { now: NOW, send })).chased).toBe(0);
  });
  it('puts the chase back to try again if the reminder could not be delivered', async () => {
    const t = setup();
    const r = await runLoaChase(fakeDb(t), { now: NOW, send: async () => ({ sent: false }) });
    expect(r.failed).toBe(1);
    expect(t.loa_signers[0].chased_at).toBeNull();
  });
  it('wording', () => {
    expect(activeMessage({ name: 'Sam Jones' }, { appointment_type: 'ao_loa' }, 'LINK')).toContain('Adjoining Owners Letter of Appointment');
    expect(activeMessage({ name: 'Pat' }, { appointment_type: 'bo_loa' }, 'LINK')).toContain('Building Owner Letter of Appointment');
  });
});
