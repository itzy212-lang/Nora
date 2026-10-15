import { describe, it, expect, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
vi.mock('../../onedrive-helper.js', () => ({ getValidMicrosoftToken: async () => null }));

import handler from '../../save-attachments-to-onedrive.js';

function res() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

describe('save-attachments-to-onedrive input checks', () => {
  it('rejects non-POST', async () => {
    const r = res(); await handler({ method: 'GET' }, r); expect(r.code).toBe(405);
  });
  it('rejects missing folder or attachments', async () => {
    const r = res(); await handler({ method: 'POST', body: { user_id: 'a@b.c', attachment_ids: [] } }, r); expect(r.code).toBe(400);
  });
  it('says plainly when the OneDrive account is not connected', async () => {
    const r = res(); await handler({ method: 'POST', body: { user_id: 'a@b.c', folder_id: 'f', attachment_ids: ['x'] } }, r);
    expect(r.code).toBe(401); expect(r.body.error).toMatch(/not connected/i);
  });
});
