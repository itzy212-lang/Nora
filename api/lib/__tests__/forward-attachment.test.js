import { describe, it, expect, vi } from 'vitest';

const state = { token: null, row: null, buf: Buffer.from('hello') };
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }) }) }) }),
}));
vi.mock('../../onedrive-helper.js', () => ({ getValidMicrosoftToken: async () => state.token }));
vi.mock('../attachment-source.js', () => ({ loadAttachmentBuffer: async () => state.buf }));

import handler from '../../forward-attachment.js';

function res() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const post = (body) => ({ method: 'POST', body });

describe('forward-attachment', () => {
  it('rejects non-POST and missing fields', async () => {
    let r = res(); await handler({ method: 'GET' }, r); expect(r.code).toBe(405);
    r = res(); await handler(post({ user_id: 'a' }), r); expect(r.code).toBe(400);
  });
  it('says plainly when Outlook is not connected', async () => {
    state.token = null;
    const r = res(); await handler(post({ user_id: 'a', attachment_id: 'x' }), r);
    expect(r.code).toBe(401); expect(r.body.error).toMatch(/not connected/i);
  });
  it('returns the file in the composer shape', async () => {
    state.token = 't'; state.row = { id: 'x', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 5 };
    const r = res(); await handler(post({ user_id: 'a', attachment_id: 'x' }), r);
    expect(r.code).toBe(200);
    expect(r.body).toEqual({ name: 'plan.pdf', type: 'application/pdf', size: 5, base64: Buffer.from('hello').toString('base64') });
  });
  it('refuses files over 3 MB with a clear message', async () => {
    state.row = { id: 'x', filename: 'big.pdf', size_bytes: 5 * 1024 * 1024 };
    const r = res(); await handler(post({ user_id: 'a', attachment_id: 'x' }), r);
    expect(r.code).toBe(413); expect(r.body.error).toMatch(/attach it manually/);
  });
});
