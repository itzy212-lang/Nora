import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent = [];
vi.mock('../../_lib/notice-response-mail.js', () => ({
  sendNoticeEmail: async (m) => { sent.push(m); return { sent: true }; },
}));

const { emailFinalisedResponse } = await import('../../_lib/notice-response-documents.js');

function fakeDb({ project, firm }) {
  const rows = { projects: project, firm_settings: firm };
  const chain = (table) => {
    const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: rows[table], error: null }) };
    return c;
  };
  return {
    from: chain,
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'surveyor@example.com' } } }) } },
    update: () => ({ eq: async () => ({}) }),
  };
}
const withUpdate = (db) => {
  const from = db.from;
  db.from = (t) => ({ ...from(t), update: () => ({ eq: async () => ({}) }) });
  return db;
};

const baseResult = (choice, extra = {}) => ({
  record: { id: 's1', choice, signer_name: 'Hilary Fine', signer_email: 'hilary@example.com', surveyor: extra.surveyor || null },
  link: { user_id: 'u1', notices: { project_id: 'p1', ao_id: 'a1' } },
  acknowledgement: Buffer.from('ack'),
  certificate: Buffer.from('cert'),
});
const db = () => withUpdate(fakeDb({
  project: { bo_1_name: 'Sam Jones', bo_1_email: 'sam.jones@example.com', bo_2_name: '', bo_2_email: '', bo_premise_address: '7 Village Close', aos: [{ id: 'a1', premise: '8 Village Close' }] },
  firm: { surveyor_name: 'Itzik Darel' },
}));

beforeEach(() => { sent.length = 0; });

describe('building owner email after an adjoining owner responds', () => {
  it('reaches a normal email address (including ones containing the letter s)', async () => {
    await emailFinalisedResponse(db(), baseResult('consent'));
    const bo = sent.find((m) => m.to[0] === 'sam.jones@example.com');
    expect(bo).toBeTruthy();
    expect(bo.attachments).toHaveLength(2);
    expect(bo.text).toMatch(/^Hi Sam,/);
    expect(bo.text).toContain('the adjoining owner of 8 Village Close has consented to the works');
  });
  it('says the right thing for each choice', async () => {
    await emailFinalisedResponse(db(), baseResult('consent_soc'));
    expect(sent.find((m) => m.to[0] === 'sam.jones@example.com').text).toMatch(/consented subject to a Schedule of Condition[\s\S]*in touch with them to arrange/);
    sent.length = 0;
    await emailFinalisedResponse(db(), baseResult('dissent_agreed'));
    expect(sent.find((m) => m.to[0] === 'sam.jones@example.com').text).toMatch(/agreed surveyor[\s\S]*in touch with them to start the process/);
    sent.length = 0;
    await emailFinalisedResponse(db(), baseResult('dissent_own', { surveyor: { name: 'Pat Lee' } }));
    expect(sent.find((m) => m.to[0] === 'sam.jones@example.com').text).toMatch(/their own surveyor[\s\S]*reach out to their surveyor \(Pat Lee\)/);
  });
  it('real line breaks, not literal backslash-n', async () => {
    await emailFinalisedResponse(db(), baseResult('consent'));
    const bo = sent.find((m) => m.to[0] === 'sam.jones@example.com');
    expect(bo.text).not.toContain('\\n');
    expect(bo.text.split('\n').length).toBeGreaterThan(5);
    expect(bo.html).toContain('<div>Hi Sam,</div>');
  });
});
