import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadAttachmentBuffer } from '../attachment-source.js';

const att = { email_external_id: 'MSG', attachment_external_id: 'ATT', storage_path: 'x/y' };
afterEach(() => vi.unstubAllGlobals());

describe('loadAttachmentBuffer', () => {
  it('fetches the attachment live from Outlook (the path that actually works)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
    vi.stubGlobal('fetch', fetchMock);
    const buf = await loadAttachmentBuffer({ sb: null, att, token: 'T' });
    expect([...buf]).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls[0][0]).toContain('/me/messages/MSG/attachments/ATT/$value');
  });
  it('says so plainly when Outlook no longer has the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(loadAttachmentBuffer({ sb: null, att, token: 'T' })).rejects.toThrow(/no longer has this message/);
  });
  it('says so plainly when Outlook is not connected', async () => {
    await expect(loadAttachmentBuffer({ sb: null, att, token: null })).rejects.toThrow(/not connected/);
  });
  it('falls back to a stored copy only if Outlook cannot supply it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const sb = { storage: { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => new Uint8Array([9]).buffer }, error: null }) }) } };
    const buf = await loadAttachmentBuffer({ sb, att, token: 'T' });
    expect([...buf]).toEqual([9]);
  });

  it('fetches a Gmail attachment (finds the part, then its data)', async () => {
    const gatt = { email_external_id: 'M1', attachment_external_id: 'gmail:M1:1.2' };
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(url);
      if (url.includes('format=full')) return { ok: true, json: async () => ({ payload: { partId: '', parts: [{ partId: '0' }, { partId: '1', parts: [{ partId: '1.2', body: { attachmentId: 'AID' } }] }] } }) };
      return { ok: true, json: async () => ({ data: Buffer.from('hi!').toString('base64').replace(/\+/g, '-').replace(/\//g, '_') }) };
    }));
    const buf = await loadAttachmentBuffer({ sb: null, att: gatt, gmailToken: 'G' });
    expect(buf.toString()).toBe('hi!');
    expect(calls[1]).toContain('/attachments/AID');
  });
  it('says plainly when Gmail is not connected', async () => {
    await expect(loadAttachmentBuffer({ sb: null, att: { attachment_external_id: 'gmail:M:1' }, gmailToken: null })).rejects.toThrow(/Gmail account is not connected/);
  });
});
