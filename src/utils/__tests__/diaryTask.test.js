import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn();
const syncSocToAO = vi.fn();
vi.mock('../../supabaseClient', () => ({
  default: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({ insert: (rows) => { insert(rows); return { select: () => ({ single: async () => insertResult }) }; } }),
  },
}));
vi.mock('../adjoiningOwners', () => ({ syncSocToAO: (...a) => syncSocToAO(...a) }));

let insertResult;
const { saveDiaryTask, guessAoId } = await import('../diaryTask.js');

const project = {
  id: 'p1',
  bo_premise_address: '18 Ickleford Road, Hitchin',
  aos: [
    { id: 'ao-20', premise: '20 Ickleford Road, Hitchin' },
    { id: 'ao-16', premise: '16 Ickleford Road, Hitchin' },
  ],
};

beforeEach(() => { insert.mockClear(); syncSocToAO.mockClear(); insertResult = { data: { id: 't1' }, error: null }; });

describe('guessAoId', () => {
  it('picks the AO whose address appears in the email text', () => {
    expect(guessAoId(project, 'Schedule of condition at 20 Ickleford Road, Hitchin')).toBe('ao-20');
  });
  it('does not guess when the text matches nothing', () => {
    expect(guessAoId(project, 'Call about something else')).toBe('');
  });
  it('picks the only AO when there is just one', () => {
    expect(guessAoId({ ...project, aos: [project.aos[0]] }, '')).toBe('ao-20');
  });
});

describe('saveDiaryTask', () => {
  it('saves an owned, project-linked task with address snapshots', async () => {
    await saveDiaryTask({ title: 'Call with Colin', date: '2026-11-20', time: '10:00', task_type: 'meeting', project_id: 'p1', description: 'From email: x' }, project);
    const row = insert.mock.calls[0][0][0];
    expect(row).toMatchObject({ user_id: 'user-1', project_id: 'p1', task_type: 'meeting', due_date: '2026-11-20', project_address_snapshot: '18 Ickleford Road, Hitchin', status: 'pending' });
    expect(syncSocToAO).not.toHaveBeenCalled();
  });

  it('links a Schedule of Condition to its adjoining owner and updates the AO card', async () => {
    await saveDiaryTask({ title: 'SOC', date: '2026-11-20', time: '09:30', task_type: 'soc', project_id: 'p1', ao_id: 'ao-16' }, project);
    const row = insert.mock.calls[0][0][0];
    expect(row).toMatchObject({ ao_id: 'ao-16', ao_address_snapshot: '16 Ickleford Road, Hitchin' });
    expect(syncSocToAO).toHaveBeenCalledWith(project, 'ao-16', { date: '2026-11-20', time: '09:30', taskId: 't1', status: 'booked' });
  });

  it('refuses a Schedule of Condition with no adjoining owner chosen', async () => {
    await expect(saveDiaryTask({ title: 'SOC', date: '2026-11-20', task_type: 'soc', project_id: 'p1' }, project)).rejects.toThrow(/adjoining owner/i);
    expect(insert).not.toHaveBeenCalled();
  });

  it('throws the database error instead of pretending it worked', async () => {
    insertResult = { data: null, error: new Error('new row violates row-level security policy') };
    await expect(saveDiaryTask({ title: 'x', date: '2026-11-20', task_type: 'appointment' }, null)).rejects.toThrow(/row-level security/);
  });
});
