import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn();
const update = vi.fn();
const syncSocToAO = vi.fn();
vi.mock('../../supabaseClient', () => ({
  default: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      insert: (rows) => { insert(rows); return { select: () => ({ single: async () => insertResult }) }; },
      update: (row) => { update(row); return { eq: () => ({ select: () => ({ single: async () => insertResult }) }) }; },
    }),
  },
}));
vi.mock('../adjoiningOwners', () => ({ syncSocToAO: (...a) => syncSocToAO(...a) }));

let insertResult;
const { saveTaskFromForm, guessAoId } = await import('../diaryTask.js');

const project = {
  id: 'p1',
  bo_premise_address: '18 Ickleford Road, Hitchin',
  aos: [
    { id: 'ao-20', premise: '20 Ickleford Road, Hitchin' },
    { id: 'ao-16', premise: '16 Ickleford Road, Hitchin' },
  ],
};

beforeEach(() => { insert.mockClear(); update.mockClear(); syncSocToAO.mockClear(); insertResult = { data: { id: 't1' }, error: null }; });

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

describe('saveTaskFromForm', () => {
  it('saves an owned, project-linked task with address snapshots', async () => {
    await saveTaskFromForm({ title: 'Call with Colin', date: '2026-11-20', time: '10:00', type: 'meeting', project_id: 'p1', notes: 'From email: x' }, null, project);
    const row = insert.mock.calls[0][0][0];
    expect(row).toMatchObject({ user_id: 'user-1', project_id: 'p1', task_type: 'meeting', due_date: '2026-11-20', description: 'From email: x', project_address_snapshot: '18 Ickleford Road, Hitchin', status: 'pending' });
    expect(syncSocToAO).not.toHaveBeenCalled();
  });

  it('links a Schedule of Condition to its adjoining owner and updates the AO card', async () => {
    await saveTaskFromForm({ title: 'SOC', date: '2026-11-20', time: '09:30', type: 'soc', project_id: 'p1', ao_id: 'ao-16' }, null, project);
    const row = insert.mock.calls[0][0][0];
    expect(row).toMatchObject({ ao_id: 'ao-16', ao_address_snapshot: '16 Ickleford Road, Hitchin' });
    expect(syncSocToAO).toHaveBeenCalledWith(project, 'ao-16', { date: '2026-11-20', time: '09:30', taskId: 't1', status: 'booked' });
  });

  it('keeps a holiday as a date range', async () => {
    await saveTaskFromForm({ title: 'Leave', date: '2026-12-01', end_date: '2026-12-05', type: 'holiday' }, null, null);
    expect(insert.mock.calls[0][0][0]).toMatchObject({ due_date: '2026-12-01', end_date: '2026-12-05' });
  });

  it('updates an existing task instead of adding a new one', async () => {
    await saveTaskFromForm({ title: 'Moved', date: '2026-11-21', type: 'meeting' }, { id: 't9', status: 'open' }, null);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ title: 'Moved', status: 'open' }));
    expect(insert).not.toHaveBeenCalled();
  });

  it('throws the database error instead of pretending it worked', async () => {
    insertResult = { data: null, error: new Error('new row violates row-level security policy') };
    await expect(saveTaskFromForm({ title: 'x', date: '2026-11-20', type: 'meeting' }, null, null)).rejects.toThrow(/row-level security/);
  });
});
