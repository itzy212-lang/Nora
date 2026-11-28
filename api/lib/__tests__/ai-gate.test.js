import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A tiny fake database: users by token, plan rows by user id, and a list of what got recorded.
const state = { users: {}, plans: {}, recorded: [] };
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async token => (state.users[token] ? { data: { user: { id: state.users[token] } }, error: null } : { data: { user: null }, error: new Error('bad token') }) },
    from: table => ({
      select: () => ({ eq: (_c, v) => ({ maybeSingle: async () => ({ data: state.plans[v] || null }) }) }),
      insert: async row => { if (table === 'entitlement_would_block') state.recorded.push(row); return { error: null }; },
    }),
  }),
}));

const { withAiGate } = await import('../ai-gate.js');

const UID_CORE = '11111111-1111-1111-1111-111111111111';
const UID_ASSIST = '22222222-2222-2222-2222-222222222222';
const UID_SOC = '33333333-3333-3333-3333-333333333333';
const UID_TARGET = '44444444-4444-4444-4444-444444444444';

const mkRes = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
const mkReq = (headers = {}, method = 'POST') => ({ method, headers });
const run = async (feature, req) => {
  const handler = vi.fn(async (_req, res) => res.status(200).json({ ran: true }));
  const res = mkRes();
  await withAiGate(feature, handler)(req, res);
  return { res, called: handler.mock.calls.length };
};

beforeEach(() => {
  state.users = { tokCore: UID_CORE, tokAssist: UID_ASSIST, tokSoc: UID_SOC };
  state.plans = {
    [UID_CORE]: { status: 'active', addons: [] },
    [UID_ASSIST]: { status: 'active', addons: ['assistant'] },
    [UID_SOC]: { status: 'active', addons: ['soc'] },
    [UID_TARGET]: { status: 'active', addons: [] },
  };
  state.recorded = [];
  delete process.env.ENTITLEMENTS_ENFORCE;
  process.env.CRON_SECRET = 'internal-secret';
});
afterEach(() => { delete process.env.ENTITLEMENTS_ENFORCE; });

describe('record-only mode (not enforcing)', () => {
  it('never blocks, but records what a Core account would have been refused', async () => {
    const { called, res } = await run('ai_tools', mkReq({ authorization: 'Bearer tokCore' }));
    expect(called).toBe(1);
    expect(res.code).toBe(200);
    expect(state.recorded).toHaveLength(1);
    expect(state.recorded[0]).toMatchObject({ user_id: UID_CORE, feature: 'ai_tools', reason: 'bolt_on_missing' });
  });
  it('lets a call with no sign-in through, and records it', async () => {
    const { called } = await run('ai_tools', mkReq({}));
    expect(called).toBe(1);
    expect(state.recorded[0]).toMatchObject({ user_id: null, feature: 'ai_tools', reason: 'not_signed_in' });
  });
  it('records nothing for an account that has the bolt-on', async () => {
    await run('ai_tools', mkReq({ authorization: 'Bearer tokAssist' }));
    expect(state.recorded).toHaveLength(0);
  });
});

describe('enforcing', () => {
  beforeEach(() => { process.env.ENTITLEMENTS_ENFORCE = '1'; });

  it('refuses a call with no sign-in (401)', async () => {
    const { res, called } = await run('ai_tools', mkReq({}));
    expect(called).toBe(0);
    expect(res.code).toBe(401);
  });
  it('refuses a Core account for an Assistant feature (402, plain message)', async () => {
    const { res, called } = await run('ai_tools', mkReq({ authorization: 'Bearer tokCore' }));
    expect(called).toBe(0);
    expect(res.code).toBe(402);
    expect(res.body.error).toBe('This needs Nora Assistant. You can add it to your plan.');
  });
  it('lets an Assistant account use Assistant features but not the Schedule of Condition', async () => {
    expect((await run('ai_tools', mkReq({ authorization: 'Bearer tokAssist' }))).called).toBe(1);
    const soc = await run('soc_ai', mkReq({ authorization: 'Bearer tokAssist' }));
    expect(soc.called).toBe(0);
    expect(soc.res.body.error).toBe('This needs Schedule of Condition. You can add it to your plan.');
  });
  it('lets a Schedule of Condition account use that, but not Assistant features', async () => {
    expect((await run('soc_ai', mkReq({ authorization: 'Bearer tokSoc' }))).called).toBe(1);
    expect((await run('ai_tools', mkReq({ authorization: 'Bearer tokSoc' }))).called).toBe(0);
  });
  it('voice works with either bolt-on, not with Core alone', async () => {
    expect((await run('voice', mkReq({ authorization: 'Bearer tokAssist' }))).called).toBe(1);
    expect((await run('voice', mkReq({ authorization: 'Bearer tokSoc' }))).called).toBe(1);
    expect((await run('voice', mkReq({ authorization: 'Bearer tokCore' }))).called).toBe(0);
  });
  it('Nora’s own server (internal secret) is checked as the user it names', async () => {
    const asTarget = await run('project_memory', mkReq({ authorization: 'Bearer internal-secret', 'x-nora-user': UID_TARGET }));
    expect(asTarget.called).toBe(0);
    expect(asTarget.res.code).toBe(402);
    state.plans[UID_TARGET].addons = ['assistant'];
    expect((await run('project_memory', mkReq({ authorization: 'Bearer internal-secret', 'x-nora-user': UID_TARGET }))).called).toBe(1);
  });
  it('a Supabase function (service key) is checked as the user it names, like the internal secret', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.ENTITLEMENTS_ENFORCE = '1';
    const asTarget = await run('project_memory', mkReq({ authorization: 'Bearer service-key', 'x-nora-user': UID_TARGET }));
    expect(asTarget.called).toBe(0);
    expect(asTarget.res.code).toBe(402);
    const noUser = await run('project_memory', mkReq({ authorization: 'Bearer service-key' }));
    expect(noUser.called).toBe(1);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  it('a wrong internal secret is just treated as a bad sign-in', async () => {
    const { res, called } = await run('ai_tools', mkReq({ authorization: 'Bearer not-the-secret', 'x-nora-user': UID_ASSIST }));
    expect(called).toBe(0);
    expect(res.code).toBe(401);
  });
});

describe('what is not checked', () => {
  it('passes preflight and wrong-method calls straight to the endpoint', async () => {
    process.env.ENTITLEMENTS_ENFORCE = '1';
    const { called } = await run('ai_tools', mkReq({}, 'OPTIONS'));
    expect(called).toBe(1);
  });
});
