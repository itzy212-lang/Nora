import { describe, it, expect, vi } from 'vitest';
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
import { collectGmailAttachments } from '../../sync-gmail.js';

describe('collectGmailAttachments', () => {
  it('finds real attachments, nested, and marks inline images', () => {
    const payload = { partId: '', mimeType: 'multipart/mixed', parts: [
      { partId: '0', mimeType: 'text/html', filename: '', body: { data: 'x' } },
      { partId: '1', mimeType: 'application/pdf', filename: 'Award draft.pdf', body: { attachmentId: 'A', size: 1000 }, headers: [] },
      { partId: '2', mimeType: 'multipart/related', filename: '', parts: [
        { partId: '2.1', mimeType: 'image/png', filename: 'logo.png', body: { attachmentId: 'B', size: 5 }, headers: [{ name: 'Content-Disposition', value: 'inline' }, { name: 'Content-ID', value: '<cid1>' }] },
      ] },
    ] };
    const out = collectGmailAttachments(payload);
    expect(out.map(a => [a.partId, a.filename, a.inline])).toEqual([['1', 'Award draft.pdf', false], ['2.1', 'logo.png', true]]);
    expect(out[0].size).toBe(1000);
  });
  it('returns nothing for a plain email', () => {
    expect(collectGmailAttachments({ partId: '', mimeType: 'text/plain', filename: '', body: { data: 'x' } })).toEqual([]);
  });
});
