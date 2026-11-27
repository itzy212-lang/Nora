import { describe, it, expect, afterEach } from 'vitest';
import { allowedOwnerKeys, allowedProjectIds } from '../plan-owners.js';
import { isAdminUser } from '../entitlements.js';

const U_ASSIST = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const U_CORE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const fakeDb = ({ plans = [], users = [], projects = [] } = {}) => ({
  auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } },
  from: table => ({
    select: () => {
      const rows = table === 'user_plans' ? plans : table === 'projects' ? projects : [];
      const q = { in: (_c, vals) => ({ then: r => r({ data: rows.filter(p => vals.includes(p.user_id)) }) }), eq: (_c, v) => ({ maybeSingle: async () => ({ data: rows.find(p => p.user_id === v) || null }) }), then: r => r({ data: rows }) };
      return q;
    },
  }),
});

afterEach(() => { delete process.env.ENTITLEMENTS_ENFORCE; });

describe('allowedOwnerKeys', () => {
  const db = fakeDb({
    plans: [{ user_id: U_ASSIST, status: 'active', addons: ['assistant'] }, { user_id: U_CORE, status: 'active', addons: [] }],
    users: [{ id: U_ASSIST, email: 'Pat@Example.com' }, { id: U_CORE, email: 'core@example.com' }],
  });
  it('does nothing (null) while plans are not enforced', async () => {
    expect(await allowedOwnerKeys(db, 'project_memory')).toBeNull();
  });
  it('when enforcing, lists only owners with Nora Assistant, as ids and as email addresses', async () => {
    process.env.ENTITLEMENTS_ENFORCE = '1';
    const { keys } = await allowedOwnerKeys(db, 'project_memory');
    expect(keys).toContain(U_ASSIST);
    expect(keys).toContain('Pat@Example.com');
    expect(keys).toContain('pat@example.com');
    expect(keys).not.toContain(U_CORE);
    expect(keys).not.toContain('core@example.com');
  });
  it('lists nobody for an unknown feature', async () => {
    process.env.ENTITLEMENTS_ENFORCE = '1';
    expect((await allowedOwnerKeys(db, 'nonsense')).keys).toEqual([]);
  });
});

describe('allowedProjectIds', () => {
  it('returns no projects when nobody is allowed', async () => {
    expect(await allowedProjectIds(fakeDb(), { keys: [] })).toEqual([]);
  });
});

describe('isAdminUser', () => {
  const db = fakeDb({ plans: [{ user_id: U_ASSIST, is_admin: true }, { user_id: U_CORE, is_admin: false }] });
  it('is true only for admins', async () => {
    expect(await isAdminUser(db, U_ASSIST)).toBe(true);
    expect(await isAdminUser(db, U_CORE)).toBe(false);
    expect(await isAdminUser(db, 'cccccccc-cccc-cccc-cccc-cccccccccccc')).toBe(false);
    expect(await isAdminUser(db, null)).toBe(false);
  });
});
