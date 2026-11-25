import { describe, it, expect } from 'vitest';
import {
  neighbourCount, isLeadEmail, isFromLeadSender, parseLead, classifyLead, composeReply, normaliseSettings,
  greetingName, tidyName, nextLeadRef, followUpDate, estimatedValue, processLeadEmails,
} from '../lead-autoreply.js';

const SENDER = 'salesleads@localsurveyorsdirect.co.uk';

const wrap = (details) => `<html><head><style>body{font-size:16px}</style></head><body><p>Sales lead for Party Wall</p><p>Dear Itzik Darel ACIArb MIPWS,&nbsp;</p><p>An enquiry for the service Party Wall has been submitted via our website.</p><p>Shortlist of estimates: UNEK Building Consultants &amp; Co</p><p>The enquirer gave us the following details:</p>${details}<p>Assuming the customer is contactable, you will need to discuss their requirements.</p><p>The full set of results presented: Contact Hasan Name: Someone Else Email: other@example.com</p></body></html>`;

const mary = {
  sender_email: SENDER, subject: 'Sales lead from Local Surveyors Direct - Party Wall in EN5',
  body: wrap('<p>Name: MRS MARY HELMORE</p><p>Email: maryh54321@gmail.com</p><p>Phone: 07852328591</p><p>Postcode: EN5 5QQ</p><p>Role: Property Owner</p><p>Information:</p>'),
};
const helen = {
  sender_email: SENDER, subject: 'Sales lead from Local Surveyors Direct - Party Wall in NW3',
  body: wrap('<p>Name: Helen Vassilakas</p><p>Email: helen.vassilakas@icloud.com</p><p>Phone: 02074858157</p><p>Postcode: NW3 2YT</p><p>Role: Property Owner</p><p>Information: Boundary Wall Status</p>'),
};

const settings = normaliseSettings({
  mode: 'send', surveyor_full_name: 'Itzik Darel ACIArb MIPWS', surveyor_short_name: 'Itzik',
  fee_notice: 100, fee_surveyor: 700, fee_soc: 450, additional_discount_pct: 50, based_in: 'North London', followup_days: 2,
});

describe('recognising a genuine lead', () => {
  it('accepts the real lead emails', () => {
    expect(isLeadEmail(mary)).toBe(true);
    expect(isLeadEmail(helen)).toBe(true);
  });
  it('ignores invoices, limit warnings and CPD emails and other senders', () => {
    expect(isLeadEmail({ ...mary, sender_email: 'billing@localsurveyorsdirect.co.uk' })).toBe(false);
    expect(isLeadEmail({ sender_email: SENDER, subject: 'Leads Limit Reached', body: 'You have reached your limit' })).toBe(false);
    expect(isLeadEmail({ sender_email: SENDER, subject: 'Invoice 123', body: 'Your invoice' })).toBe(false);
    expect(isLeadEmail({ ...mary, subject: 'CPD event invitation' })).toBe(false);
    expect(isLeadEmail({ ...mary, sender_email: 'someone@example.com' })).toBe(false);
    expect(isLeadEmail({ sender_email: SENDER, subject: mary.subject, body: '<p>no details here</p>' })).toBe(false);
  });
  it('flags anything from the lead sender so normal replies never go to them', () => {
    expect(isFromLeadSender({ sender_email: 'SalesLeads@LocalSurveyorsDirect.co.uk' })).toBe(true);
    expect(isFromLeadSender({ sender_email: 'x@example.com' })).toBe(false);
  });
});

describe('reading the details', () => {
  it('reads the enquirer, not the surveyor shortlist that follows', () => {
    const l = parseLead(mary);
    expect(l.name).toBe('Mrs Mary Helmore');
    expect(l.email).toBe('maryh54321@gmail.com');
    expect(l.phone).toBe('07852328591');
    expect(l.postcode).toBe('EN5 5QQ');
    expect(l.role).toBe('Property Owner');
    expect(l.information).toBe('');
  });
  it('reads a short information line', () => {
    const l = parseLead(helen);
    expect(l.email).toBe('helen.vassilakas@icloud.com');
    expect(l.information).toBe('Boundary Wall Status');
  });
  it('tidies names and greets sensibly', () => {
    expect(tidyName('MRS MARY HELMORE')).toBe('Mrs Mary Helmore');
    expect(tidyName('Anne McDonald')).toBe('Anne McDonald');
    expect(greetingName('Mrs Mary Helmore')).toBe('Mary');
    expect(greetingName('Mrs Helmore')).toBe('Mrs Helmore');
    expect(greetingName('Helen Vassilakas')).toBe('Helen');
    expect(greetingName('')).toBe('there');
  });
});

describe('who is doing the works (strict)', () => {
  const c = (information, role = 'Property Owner') => classifyLead({ information, role });
  it('no information, or a vague phrase, is unclear', () => {
    expect(c('')).toBe('unclear');
    expect(c('Boundary Wall Status')).toBe('unclear');
    expect(c('Please call me')).toBe('unclear');
  });
  it('a neighbour doing works is never priced', () => {
    expect(c('My neighbour is building an extension and I have received a notice')).toBe('neighbour_works');
    expect(c('Next door are doing a loft conversion')).toBe('neighbour_works');
    expect(c('I have been served a party wall notice')).toBe('neighbour_works');
    expect(c('I am the adjoining owner')).toBe('neighbour_works');
    expect(c('anything', 'Adjoining Owner')).toBe('neighbour_works');
    expect(c('Neighbour has planning permission')).toBe('neighbour_works');
  });
  it('owner doing the works is priced', () => {
    expect(c('I am planning a loft conversion')).toBe('owner_works');
    expect(c('We want to build a rear extension')).toBe('owner_works');
    expect(c('Need to serve a party wall notice on my neighbour for our extension')).toBe('neighbour_works'); // neighbour wording wins: safest
    expect(c('I need a party wall surveyor for my basement')).toBe('owner_works');
  });
  it('mixed or doubtful wording never gets a price', () => {
    expect(c('My neighbour and I are both planning extensions')).toBe('neighbour_works');
  });
});

describe('reply wording', () => {
  it('owner pricing reply follows the approved wording, uses the user\'s fees and never mentions location of the works', () => {
    const r = composeReply('owner_works', { name: 'Mrs Mary Helmore', information: 'Loft conversion', postcode: 'EN5 5QQ' }, settings);
    expect(r.kind).toBe('owner_works_pricing');
    expect(r.body).toContain('Hi Mary,');
    expect(r.body).toContain('We are party wall specialists based in North London.');
    expect(r.body).toContain('Local Surveyors Direct in relation to notifiable works under the Party Wall Act, namely: Loft conversion.');
    expect(r.body).toContain('Your named surveyor, if you decide to go with us, will be Itzik Darel ACIArb MIPWS');
    expect(r.body).toContain('£100 for serving the notice and £700 for acting as your surveyor');
    expect(r.body).toContain('four options');
    expect(r.body).toContain('1. Consent outright');
    expect(r.body).toContain('2. Consent subject to a schedule of condition. In this scenario our fee would be £450.');
    expect(r.body).toContain('3. Dissent and agree to appoint your surveyor as the agreed surveyor.');
    expect(r.body).toContain('We do not charge extra to act as the agreed surveyor.');
    expect(r.body).toContain("4. Dissent and appoint their own surveyor. In this scenario our fee would be £700, and you would also pay their surveyor's fees.");
    expect(r.body).toContain('each additional neighbour would be £100');
    expect(r.body).toContain('50% reduction');
    expect(r.body).toContain("you would pay their surveyor's fees in full");
    expect(r.body).not.toMatch(/EN5/);
  });
  it('quotes a first-person description instead of running it into the sentence', () => {
    const r = composeReply('owner_works', { name: 'A B', information: 'I am planning a loft conversion' }, settings);
    expect(r.body).toContain('Party Wall Act ("I am planning a loft conversion").');
  });
  it('adapts to the number of neighbours the enquirer mentions', () => {
    expect(neighbourCount('We want a loft conversion and have 3 neighbours')).toBe(3);
    expect(neighbourCount('extension, two neighbours')).toBe(2);
    expect(neighbourCount('both neighbours')).toBe(2);
    expect(neighbourCount('one neighbour')).toBe(null);
    expect(neighbourCount('a neighbour')).toBe(null);
    expect(neighbourCount('')).toBe(null);
    const r = composeReply('owner_works', { name: 'A B', information: 'I want to build an extension and I have 3 neighbours' }, settings);
    expect(r.body).toContain('You mentioned you have 3 neighbours.');
    expect(r.body).toContain('does not necessarily mean that all 3 need to be served a notice');
    expect(r.body).toContain('Itzik will discuss that with you');
    expect(r.body).toContain('3 x £100 = £300');
    expect(r.body).toContain('£900 for option 2');   // 450 + 225 + 225
    expect(r.body).toContain('£1,400 for option 3 or option 4'); // 700 + 350 + 350
    expect(r.body).not.toContain('Please note: if you have more than one neighbour');
  });
  it('keeps the works vague when none was given', () => {
    const r = composeReply('owner_works', { name: 'A B', information: '' }, settings);
    expect(r.body).toContain('under the Party Wall Act.');
    expect(r.body).not.toContain('namely');
  });
  it('neighbour reply reassures, explains the next steps and has no prices', () => {
    const r = composeReply('neighbour_works', { name: 'Helen Vassilakas' }, settings);
    expect(r.kind).toBe('no_pricing');
    expect(r.body).not.toMatch(/£/);
    expect(r.body).toContain('we have got your back');
    expect(r.body).toContain('Itzik Darel ACIArb MIPWS is an experienced party wall surveyor');
    expect(r.body).toContain('protections you have under the Party Wall Act');
    expect(r.body).toContain("reach out to your neighbour's surveyor");
    expect(r.body).toContain('schedule of condition of your property');
    expect(r.body).toContain('preference on timing');
  });
  it('unclear reply is friendly, has no prices and does not assume a neighbour is doing works', () => {
    const r = composeReply('unclear', { name: 'Helen Vassilakas' }, settings);
    expect(r.body).not.toMatch(/£/);
    expect(r.body).not.toMatch(/neighbour/i);
    expect(r.body).toContain('Itzik Darel ACIArb MIPWS is an experienced party wall surveyor');
    expect(r.body).toContain('preference on timing');
  });
  it('ends with a plain sign-off the email wrapper recognises, so it is not doubled', () => {
    for (const kind of ['owner_works', 'neighbour_works', 'unclear']) {
      const r = composeReply(kind, { name: 'A B', information: 'loft' }, settings);
      expect(r.body.trim().endsWith('Kind regards,\nNora')).toBe(true);
      expect(r.body).not.toContain('On behalf of');
    }
  });
  it('says "both" for two neighbours', () => {
    const r = composeReply('owner_works', { name: 'A B', information: 'I want to dig a basement and I have two neighbours' }, settings);
    expect(r.body).toContain('does not necessarily mean that both need to be served a notice');
    expect(r.body).toContain('If you do need to serve both');
    expect(r.body).not.toMatch(/all 2/);
  });
  it('falls back to the no-price reply when fees are not set up', () => {
    const bare = normaliseSettings({ mode: 'send', surveyor_full_name: 'Itzik Darel' });
    const r = composeReply('owner_works', { name: 'A B', information: 'loft' }, bare);
    expect(r.body).not.toMatch(/£/);
    expect(r.kind).toBe('owner_works_no_pricing_setup');
  });
});

describe('saved lead details', () => {
  it('numbers lead refs, dates the follow-up and values only owner leads', () => {
    expect(nextLeadRef(['SQ1-LD-2026-0007', 'SQ1-LD-2025-0099', 'SQ1-2026-001'], 2026)).toBe('SQ1-LD-2026-0008');
    expect(nextLeadRef([], 2026)).toBe('SQ1-LD-2026-0001');
    expect(followUpDate(new Date('2026-11-25T10:00:00Z'), 2)).toBe('2026-11-27');
    expect(estimatedValue('owner_works', settings)).toBe(800);
    expect(estimatedValue('neighbour_works', settings)).toBe(null);
  });
  it('off by default and rejects bad settings', () => {
    expect(normaliseSettings(null).mode).toBe('off');
    expect(normaliseSettings({ mode: 'yes please' }).mode).toBe('off');
    expect(normaliseSettings({ fee_notice: 'abc' }).fee_notice).toBe(null);
  });
});

// A tiny in-memory stand-in for the database, enough to run the whole job.
function fakeDb({ emails, settingsRow, logRows = [] }) {
  const t = { emails, firm_settings: [settingsRow], lead_autoreply_log: logRows, projects: [], tasks: [] };
  const from = (name) => {
    let rows = t[name]; let filters = []; let op = 'select'; let payload;
    const q = {
      select: () => q, eq: (k, v) => { filters.push(r => r[k] === v); return q; }, in: (k, vs) => { filters.push(r => vs.includes(r[k])); return q; },
      gte: () => q, order: () => q, like: () => q, limit: () => q, is: () => q,
      insert: (p) => { op = 'insert'; payload = p; return q; },
      update: (p) => { op = 'update'; payload = p; return q; },
      single: () => q,
      then: (res) => {
        let out;
        if (op === 'insert') { const row = { id: 'id' + Math.random(), ...payload }; if (name === 'lead_autoreply_log' && t.lead_autoreply_log.some(r => r.email_id === row.email_id)) out = { data: null, error: { message: 'duplicate' } }; else { t[name].push(row); out = { data: row, error: null }; } }
        else if (op === 'update') { rows.filter(r => filters.every(f => f(r))).forEach(r => Object.assign(r, payload)); out = { data: null, error: null }; }
        else out = { data: rows.filter(r => filters.every(f => f(r))), error: null };
        return Promise.resolve(out).then(res);
      },
    };
    return q;
  };
  return { from, t };
}

describe('the whole job', () => {
  const owner = 'owner-1';
  const mk = (mode) => {
    const db = fakeDb({
      emails: [{ id: 'e1', user_id: owner, direction: 'incoming', is_draft: false, sender_email: SENDER, received_at: '2026-11-25T09:00:00Z', ...mary }],
      settingsRow: { user_id: owner, lead_autoreply: { mode, surveyor_full_name: 'Itzik Darel ACIArb MIPWS', surveyor_short_name: 'Itzik', fee_notice: 100, fee_surveyor: 700, fee_soc: 450, additional_discount_pct: 50, followup_days: 2 } },
    });
    const sent = [];
    const deps = { supabase: db, resolveOwnerUserId: async (u) => u, sendMail: async (m) => { sent.push(m); }, automaticSendingAllowed: () => true, now: new Date('2026-11-25T10:00:00Z') };
    return { db, sent, deps };
  };

  it('does nothing while switched off', async () => {
    const { db, sent, deps } = mk('off');
    const s = await processLeadEmails(deps);
    expect(sent).toHaveLength(0); expect(db.t.projects).toHaveLength(0); expect(s.skipped).toBe(1);
  });
  it('dry run writes what it would send but sends and saves nothing', async () => {
    const { db, sent, deps } = mk('dry_run');
    await processLeadEmails(deps);
    expect(sent).toHaveLength(0); expect(db.t.projects).toHaveLength(0); expect(db.t.tasks).toHaveLength(0);
    expect(db.t.lead_autoreply_log[0].status).toBe('dry_run');
    expect(db.t.lead_autoreply_log[0].reply_body).toContain('Hi Mary,');
  });
  it('send mode saves the lead, adds the follow-up, replies once, and never repeats', async () => {
    const { db, sent, deps } = mk('send');
    await processLeadEmails(deps);
    expect(sent).toHaveLength(1);
    expect(sent[0].toEmail).toBe('maryh54321@gmail.com');
    expect(db.t.projects).toHaveLength(1);
    expect(db.t.projects[0]).toMatchObject({ stage: 'lead', bo_1_name: 'Mrs Mary Helmore', bo_phone: '07852328591' });
    expect(db.t.projects[0].ref).toMatch(/^SQ1-LD-2026-\d{4}$/);
    expect(db.t.tasks[0]).toMatchObject({ due_date: '2026-11-27', project_id: db.t.projects[0].id, task_type: 'email_follow_up' });
    expect(db.t.lead_autoreply_log[0].status).toBe('sent');
    await processLeadEmails(deps);
    expect(sent).toHaveLength(1); expect(db.t.projects).toHaveLength(1); expect(db.t.tasks).toHaveLength(1);
  });
  it('test switch sends every reply to the test address, never to the enquirer', async () => {
    const { db, sent, deps } = mk('send');
    db.t.firm_settings[0].lead_autoreply.redirect_to = 'me@example.com';
    await processLeadEmails(deps);
    expect(sent).toHaveLength(1);
    expect(sent[0].toEmail).toBe('me@example.com');
    expect(sent[0].subject).toBe('[TEST - would go to maryh54321@gmail.com] Your party wall enquiry');
  });
  it('still saves the lead and diary entry when automatic sending is not allowed, but sends nothing', async () => {
    const { db, sent, deps } = mk('send');
    await processLeadEmails({ ...deps, automaticSendingAllowed: () => false });
    expect(sent).toHaveLength(0); expect(db.t.projects).toHaveLength(1);
    expect(db.t.lead_autoreply_log[0].status).toBe('saved_only');
  });
});
