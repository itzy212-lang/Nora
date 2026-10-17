import { describe, it, expect, vi, afterEach } from 'vitest';

const db = { integ: null, atts: [] };
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === 'user_integrations' ? db.integ : null }) }),
        in: async () => ({ data: db.atts, error: null }),
      }),
      update: () => ({ eq: async () => ({}) }),
    }),
  }),
}));
vi.mock('../../onedrive-helper.js', () => ({ getValidMicrosoftToken: async (u) => (u === 'connected@x.com' ? 'MS' : null) }));
vi.mock('../../create-google-drive-folder.js', () => ({ driveUploadFile: vi.fn(async (t, o) => ({ id: 'newid', name: o.filename, webViewLink: 'u' })) }));

import list from '../../storage-list.js';
import save from '../../save-attachments-to-storage.js';
import { getProviderContext } from '../provider-context.js';

const res = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
afterEach(() => { vi.unstubAllGlobals(); db.integ = null; db.atts = []; });

describe('provider context', () => {
  it('defaults to Outlook + OneDrive, honours Gmail + Google Drive', async () => {
    const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.integ }) }) }) }) };
    expect((await getProviderContext({ sb, userEmail: 'a', userUuid: 'u' })).storage).toBe('onedrive');
    db.integ = { email_provider: 'gmail', storage_provider: 'googledrive' };
    const c = await getProviderContext({ sb, userEmail: 'a', userUuid: 'u' });
    expect(c.mail).toBe('gmail'); expect(c.storage).toBe('googledrive');
  });
});

describe('storage-list', () => {
  it('rejects non-POST and missing user', async () => {
    let r = res(); await list({ method: 'GET' }, r); expect(r.code).toBe(405);
    r = res(); await list({ method: 'POST', body: {} }, r); expect(r.code).toBe(400);
  });
  it('lists a OneDrive folder in the common shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ value: [{ id: '1', name: 'Sub', folder: {} }, { id: '2', name: 'a.pdf', size: 9, file: { mimeType: 'application/pdf' }, lastModifiedDateTime: 'T' }] }) })));
    const r = res(); await list({ method: 'POST', body: { user_id: 'connected@x.com', folder_id: 'F' } }, r);
    expect(r.code).toBe(200);
    expect(r.body.provider).toBe('onedrive');
    expect(r.body.items).toEqual([
      { id: '1', name: 'Sub', folder: true, size: 0, modified: null, mimeType: null },
      { id: '2', name: 'a.pdf', folder: false, size: 9, modified: 'T', mimeType: 'application/pdf' },
    ]);
  });
  it('lists a Google Drive folder in the same shape', async () => {
    db.integ = { user_id: 'u', storage_provider: 'googledrive', google_drive_access_token: 'G' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ files: [{ id: 'f', name: 'Dir', mimeType: 'application/vnd.google-apps.folder' }, { id: 'g', name: 'b.docx', mimeType: 'x', size: '5', modifiedTime: 'T2' }] }) })));
    const r = res(); await list({ method: 'POST', body: { user_id: 'e', user_uuid: 'u' } }, r);
    expect(r.body.provider).toBe('googledrive');
    expect(r.body.items.map(i => [i.name, i.folder, i.size])).toEqual([['Dir', true, 0], ['b.docx', false, 5]]);
  });
  it('says plainly when OneDrive is not connected', async () => {
    const r = res(); await list({ method: 'POST', body: { user_id: 'nobody@x.com' } }, r);
    expect(r.code).toBe(401); expect(r.body.error).toMatch(/not connected/);
  });
});

describe('save-attachments-to-storage', () => {
  it('validates input', async () => {
    const r = res(); await save({ method: 'POST', body: { user_id: 'a', attachment_ids: [] } }, r); expect(r.code).toBe(400);
  });
  it('saves a Gmail attachment into Google Drive', async () => {
    db.integ = { user_id: 'u', email_provider: 'gmail', storage_provider: 'googledrive', google_drive_access_token: 'D', gmail_access_token: 'GM' };
    db.atts = [{ id: 'a1', filename: 'plan.pdf', content_type: 'application/pdf', attachment_external_id: 'gmail:M1:1', email_external_id: 'M1' }];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('format=full')) return { ok: true, json: async () => ({ payload: { parts: [{ partId: '1', body: { data: Buffer.from('xyz').toString('base64') } }] } }) };
      return { ok: true, json: async () => ({}) };
    }));
    const r = res(); await save({ method: 'POST', body: { user_id: 'e', user_uuid: 'u', folder_id: 'FOLDER', attachment_ids: ['a1'] } }, r);
    expect(r.code).toBe(200);
    expect(r.body.provider).toBe('googledrive');
    expect(r.body.saved).toBe(1);
  });
});
