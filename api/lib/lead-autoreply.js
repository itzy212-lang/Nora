// api/lib/lead-autoreply.js
//
// Local Surveyors Direct sales-lead handling: read the lead email, decide
// what kind of enquiry it is, send a fixed-wording reply, save the lead in the
// Leads list and put a follow-up in the diary.
//
// Deliberately NOT an AI call. The reply wording is fixed text with the user's
// own fee figures dropped in, and the "who is doing the works" decision is a
// strict, testable rule set that defaults to the safe answer (no prices).
//
// Everything user-specific (fees, surveyor name, follow-up days, on/off) lives
// in firm_settings.lead_autoreply so it works the same for every user.

export const LEAD_SENDERS = ['salesleads@localsurveyorsdirect.co.uk'];
const LEAD_SUBJECT_RE = /^\s*sales lead from local surveyors direct/i;
const LEAD_DETAILS_MARKER = /the enquirer gave us the following details/i;

export const LEAD_MODES = ['off', 'dry_run', 'send'];

// ── Recognise a genuine lead email ────────────────────────────────────────
// Sender must be exactly the sales-leads address AND the subject must be the
// lead subject AND the body must contain the enquirer details block. Invoices,
// "Leads Limit Reached" and CPD emails from other Local Surveyors Direct
// addresses fail at least one of these.
export function isLeadEmail(email) {
  const sender = String(email?.sender_email || '').trim().toLowerCase();
  if (!LEAD_SENDERS.includes(sender)) return false;
  if (!LEAD_SUBJECT_RE.test(String(email?.subject || ''))) return false;
  return LEAD_DETAILS_MARKER.test(htmlToText(email?.body || ''));
}

// Anything from the lead sender, genuine or not — used so Nora's normal reply
// machinery never drafts to Local Surveyors Direct themselves.
export function isFromLeadSender(email) {
  return LEAD_SENDERS.includes(String(email?.sender_email || '').trim().toLowerCase());
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[\u200b\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Read the enquirer details ─────────────────────────────────────────────
const FIELD_LABELS = ['Name', 'Email', 'Phone', 'Postcode', 'Role', 'Information'];

export function parseLead(email) {
  const text = htmlToText(email?.body || '');
  const start = text.search(LEAD_DETAILS_MARKER);
  if (start < 0) return null;
  let block = text.slice(start).replace(LEAD_DETAILS_MARKER, '');
  block = block.replace(/^[\s:]+/, '');
  const end = block.search(/assuming the customer is contactable|the full set of results/i);
  if (end >= 0) block = block.slice(0, end);

  const labelRe = new RegExp('\\b(' + FIELD_LABELS.join('|') + '):\\s*', 'g');
  const found = [];
  let m;
  while ((m = labelRe.exec(block)) !== null) {
    found.push({ label: m[1], valueStart: m.index + m[0].length, labelStart: m.index });
  }
  const out = {};
  found.forEach((f, i) => {
    const valueEnd = i + 1 < found.length ? found[i + 1].labelStart : block.length;
    // A label only counts the first time it appears (the free-text Information
    // field could itself contain a word like "Email:").
    if (out[f.label] === undefined) out[f.label] = block.slice(f.valueStart, valueEnd).trim();
  });

  const emailMatch = String(out.Email || '').match(/[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+/);
  const lead = {
    name: tidyName(out.Name || ''),
    email: emailMatch ? emailMatch[0].toLowerCase() : '',
    phone: String(out.Phone || '').replace(/[^\d+()\s-]/g, '').trim(),
    postcode: String(out.Postcode || '').toUpperCase().trim(),
    role: String(out.Role || '').trim(),
    information: String(out.Information || '').trim(),
  };
  // No usable email address = nobody to reply to. Still a lead worth saving.
  return lead;
}

const TITLE_RE = /^(mr|mrs|ms|miss|mx|dr|prof|sir|dame)\.?$/i;

export function tidyName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const letters = s.replace(/[^A-Za-z]/g, '');
  const allCaps = letters && letters === letters.toUpperCase();
  const allLower = letters && letters === letters.toLowerCase();
  if (!allCaps && !allLower) return s;
  return s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

// "Mrs Mary Helmore" → "Mary"; "Mrs Helmore" → "Mrs Helmore"; "" → "there"
export function greetingName(name) {
  const parts = String(name || '').split(' ').filter(Boolean);
  if (!parts.length) return 'there';
  const hasTitle = TITLE_RE.test(parts[0]);
  const rest = hasTitle ? parts.slice(1) : parts;
  if (rest.length >= 2) return rest[0];
  if (hasTitle && rest.length === 1) return `${parts[0].replace(/\.$/, '')} ${rest[0]}`;
  return rest[0] || 'there';
}

// ── Decide what kind of enquiry it is ─────────────────────────────────────
// Strict on purpose. A price is only ever sent when the enquirer clearly says
// THEY are doing the works. Anything about a neighbour doing works — or
// anything not clear — gets the no-price reply.
export const LEAD_KINDS = ['neighbour_works', 'owner_works', 'unclear'];

const WORK_WORDS = '(build|building|built|extension|extend|extending|loft|conversion|convert|dig|digging|excavat\\w*|basement|underpin\\w*|demolish\\w*|knock\\w*|renovat\\w*|construct\\w*|works?|scaffold\\w*|foundation\\w*|chimney|steel|rsj|party wall|wall|garage|dormer|rear|side return|storey|story|planning)';

const NEIGHBOUR_PATTERNS = [
  // "my neighbour is building / has planning / wants to extend..."
  new RegExp('\\b(neighbou?rs?|neighbou?r\'?s|next[- ]door|adjoining owner|adjacent owner)\\b[^.!?]{0,120}\\b' + WORK_WORDS + '\\b', 'i'),
  // "received / been served a party wall notice", "neighbour served notice"
  /\b(received|been served|got|served (me|us|with)|have been sent|was sent|sent (me|us))\b[^.!?]{0,60}\b(party wall )?(notice|award|letter)\b/i,
  /\b(notice|award)\b[^.!?]{0,40}\b(from|by) (my|our|the) (neighbou?r|next[- ]door)/i,
  /\bi('?m| am| are|'re)? (the )?(adjoining|adjacent) owner\b/i,
  /\b(neighbou?r|next[- ]door)\b[^.!?]{0,40}\b(has|have|is|are|wants?|plans?|planning|going)\b/i,
];

const OWNER_PATTERNS = [
  // "I am planning a loft conversion", "we are going to extend", "I want to dig a basement"
  new RegExp('\\b(i|we)\\b\\s*(am|are|\'m|\'re|will be|have|ve|plan|want|wish|intend|need|would like|\'d like|hope|hoping|looking)\\b[^.!?]{0,80}\\b' + WORK_WORDS + '\\b', 'i'),
  new RegExp('\\b(i|we)\\s+(plan|want|wish|intend|need|would like|\'d like|hope) to\\b[^.!?]{0,80}\\b' + WORK_WORDS + '\\b', 'i'),
  // "my loft conversion", "our extension"
  /\b(my|our)\s+(proposed\s+|planned\s+|new\s+)?(loft|extension|basement|conversion|build|building works|renovation|refurbishment|project)\b/i,
  // "need to serve a party wall notice", "serve notice on my neighbour"
  /\b(serve|serving|issue|issuing|send|sending)\b[^.!?]{0,30}\b(party wall )?(notice)\b/i,
  /\bneed(s)? (a )?party wall (surveyor|notice|agreement|award)\b/i,
];

export function classifyLead(lead) {
  const info = String(lead?.information || '').replace(/\s+/g, ' ').trim();
  const role = String(lead?.role || '').toLowerCase();

  if (/neighbou?r|adjoining|adjacent/.test(role)) return 'neighbour_works';
  if (!info) return 'unclear';

  // Neighbour signals win over owner signals: if there is any hint the works
  // are being done by someone else, no price goes out.
  if (NEIGHBOUR_PATTERNS.some(re => re.test(info))) return 'neighbour_works';
  if (OWNER_PATTERNS.some(re => re.test(info))) return 'owner_works';
  return 'unclear';
}

// ── Settings ──────────────────────────────────────────────────────────────
export function normaliseSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const mode = LEAD_MODES.includes(s.mode) ? s.mode : 'off';
  const money = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const days = Number.isFinite(Number(s.followup_days)) && Number(s.followup_days) >= 0 ? Math.round(Number(s.followup_days)) : 2;
  return {
    mode,
    surveyor_full_name: String(s.surveyor_full_name || '').trim(),   // e.g. "Itzik Darel ACIArb MIPWS"
    surveyor_short_name: String(s.surveyor_short_name || '').trim(), // e.g. "Itzik"
    sign_off_name: String(s.sign_off_name || 'Nora').trim(),
    fee_notice: money(s.fee_notice),
    fee_surveyor: money(s.fee_surveyor),
    fee_additional: money(s.fee_additional),
    followup_days: days,
  };
}

export function pricingReady(settings) {
  return !!(settings.fee_notice && settings.fee_surveyor && settings.fee_additional && settings.surveyor_full_name);
}

const gbp = (n) => '£' + Number(n).toLocaleString('en-GB');

// ── Reply wording (fixed text) ────────────────────────────────────────────
function tidyWorks(info) {
  const s = String(info || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 220) return '';
  return s.replace(/[.!\s]+$/, '');
}

export function composeReply(kind, lead, settings) {
  const first = greetingName(lead?.name);
  const surveyorShort = settings.surveyor_short_name || settings.surveyor_full_name || 'The surveyor';
  const surveyorFull = settings.surveyor_full_name || surveyorShort;
  const signOff = `Kind regards,\n${settings.sign_off_name}\nOn behalf of ${surveyorFull}`;

  if (kind === 'owner_works' && pricingReady(settings)) {
    const works = tidyWorks(lead?.information);
    const intro = works
      ? `Hi ${first},\n\nThank you for your enquiry. We received your details from Local Surveyors Direct regarding your proposed works ("${works}").`
      : `Hi ${first},\n\nThank you for your enquiry. We received your details from Local Surveyors Direct regarding your proposed works.`;
    const body = [
      intro,
      `If you have one adjoining owner, our fee is ${gbp(settings.fee_notice)} to serve the notice and ${gbp(settings.fee_surveyor)} to act for you as your surveyor. We do not charge extra to act as the agreed surveyor between you and each neighbour.`,
      `If you have more than one neighbour, each additional appointment is ${gbp(settings.fee_additional)}.`,
      `These fees are subject to reviewing the drawings and the notifiable works.`,
      `Once the go-ahead has been received, notices are typically sent within 24 hours.`,
      `${surveyorFull} will be your named surveyor and will reach out to you directly as soon as available.`,
      signOff,
    ].join('\n\n');
    return { subject: 'Your party wall enquiry', body, kind: 'owner_works_pricing' };
  }

  // Neighbour doing works, unclear, or fees not set up: no prices.
  const body = [
    `Hi ${first},`,
    `Thank you for your enquiry via Local Surveyors Direct. We'll be in touch shortly.`,
    `If you have a preference on timing, please let me know. Otherwise, ${surveyorShort} will reach out as soon as available.`,
    signOff,
  ].join('\n\n');
  return { subject: 'Your party wall enquiry', body, kind: kind === 'owner_works' ? 'owner_works_no_pricing_setup' : 'no_pricing' };
}

// ── What gets saved in the Leads list ─────────────────────────────────────
export function leadNotes(lead, kind, settings) {
  const kindText = {
    neighbour_works: 'Enquirer suggests a neighbour is doing the works (no prices sent).',
    owner_works: 'Enquirer says they are doing the works.',
    unclear: 'Not clear who is doing the works (no prices sent).',
  }[kind];
  return ['Lead from Local Surveyors Direct.', kindText, lead.role ? `Role given: ${lead.role}.` : '', lead.information ? `Their words: ${lead.information}` : ''].filter(Boolean).join(' ');
}

export function estimatedValue(kind, settings) {
  return kind === 'owner_works' && settings.fee_notice && settings.fee_surveyor ? settings.fee_notice + settings.fee_surveyor : null;
}

export function followUpDate(now, days) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nextLeadRef(existingRefs, year) {
  const prefix = `SQ1-LD-${year}-`;
  const nums = (existingRefs || []).map(r => String(r || '')).filter(r => r.startsWith(prefix)).map(r => parseInt(r.slice(prefix.length), 10) || 0);
  return prefix + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0');
}

// ── The job ───────────────────────────────────────────────────────────────
// Dependencies are passed in so this can be tested without a database.
//   deps.supabase            service-role client
//   deps.resolveOwnerUserId  (rawUserId) => uuid | null
//   deps.sendMail            async ({ ownerUserId, rawUserId, toEmail, subject, body, replyToEmailId }) => void
//   deps.automaticSendingAllowed (ownerUserId) => boolean   (account-level safety gate)
//   deps.now                 Date (optional)
export async function processLeadEmails(deps) {
  const { supabase, resolveOwnerUserId, sendMail, automaticSendingAllowed } = deps;
  const now = deps.now || new Date();
  const summary = { checked: 0, handled: 0, sent: 0, dry_run: 0, skipped: 0, errors: 0 };

  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('emails')
    .select('id, subject, body, sender_email, sender_name, received_at, user_id, thread_id, project_id, direction')
    .eq('direction', 'incoming')
    .eq('is_draft', false)
    .in('sender_email', LEAD_SENDERS)
    .gte('received_at', since)
    .order('received_at', { ascending: true })
    .limit(25);
  if (error) throw error;

  const { data: settingsRows } = await supabase.from('firm_settings').select('user_id, lead_autoreply');
  const settingsByUser = new Map((settingsRows || []).map(r => [r.user_id, normaliseSettings(r.lead_autoreply)]));

  for (const email of rows || []) {
    summary.checked++;
    try {
      if (!isLeadEmail(email)) { summary.skipped++; continue; }
      const ownerUserId = await resolveOwnerUserId(email.user_id);
      if (!ownerUserId) { summary.skipped++; continue; }
      const settings = settingsByUser.get(ownerUserId) || normaliseSettings(null);
      if (settings.mode === 'off') { summary.skipped++; continue; }

      // Already handled? One log row per email, enforced by a unique key.
      const { data: done } = await supabase.from('lead_autoreply_log').select('id, status').eq('email_id', email.id).limit(1);
      if (done?.length) {
        // A dry run never blocks a later real send.
        if (!(done[0].status === 'dry_run' && settings.mode === 'send')) { summary.skipped++; continue; }
      }

      const lead = parseLead(email);
      if (!lead) { summary.skipped++; continue; }
      const kind = classifyLead(lead);
      const reply = composeReply(kind, lead, settings);

      if (settings.mode === 'dry_run') {
        await upsertLog(supabase, done?.[0], {
          email_id: email.id, user_id: ownerUserId, status: 'dry_run', kind, lead, reply_subject: reply.subject, reply_body: reply.body, reply_kind: reply.kind,
        });
        summary.dry_run++; summary.handled++;
        continue;
      }

      // mode === 'send'
      const canSend = !!lead.email && (!automaticSendingAllowed || automaticSendingAllowed(ownerUserId));
      // A pricing reply is only ever auto-sent when every fee is set; composeReply already
      // falls back to the no-price wording otherwise.

      // 0. Claim this email first. The unique key on email_id means a crashed or
      //    overlapping run can never create a second lead or send a second reply.
      if (!done?.length) {
        const { error: claimErr } = await supabase.from('lead_autoreply_log').insert({ email_id: email.id, user_id: ownerUserId, status: 'processing', kind, lead });
        if (claimErr) { summary.skipped++; continue; }
      }
      const logRef = done?.[0] || (await supabase.from('lead_autoreply_log').select('id, status').eq('email_id', email.id).limit(1)).data?.[0];

      // 1. Save the lead (once).
      const leadRow = await createLead(supabase, { lead, kind, settings, ownerUserId, now });

      // 2. Follow-up in the diary.
      await supabase.from('tasks').insert({
        title: `Follow up lead: ${lead.name || lead.email || 'Local Surveyors Direct enquiry'}`,
        description: [`Local Surveyors Direct lead.`, lead.phone && `Phone: ${lead.phone}`, lead.email && `Email: ${lead.email}`, lead.postcode && `Postcode: ${lead.postcode}`, lead.information && `Their words: ${lead.information}`].filter(Boolean).join('\n'),
        status: 'open',
        priority: 'normal',
        task_type: 'email_follow_up',
        source: 'assistant',
        due_date: followUpDate(now, settings.followup_days),
        project_id: leadRow.id,
        user_id: ownerUserId,
        linked_email_message_id: email.id,
        linked_email_thread_id: email.thread_id || null,
      });

      // 3. Link the lead email to the lead.
      await supabase.from('emails').update({ project_id: leadRow.id }).eq('id', email.id);

      // 4. Reply to the enquirer.
      let status = 'saved_only';
      if (canSend) {
        await sendMail({ ownerUserId, rawUserId: email.user_id, toEmail: lead.email, subject: reply.subject, body: reply.body, replyToEmailId: null, projectId: leadRow.id });
        status = 'sent';
        summary.sent++;
      }

      await upsertLog(supabase, logRef, {
        email_id: email.id, user_id: ownerUserId, status, kind, lead, reply_subject: reply.subject, reply_body: reply.body, reply_kind: reply.kind, project_id: leadRow.id,
      });
      summary.handled++;
    } catch (e) {
      summary.errors++;
      console.warn('[lead-autoreply] failed for email', email.id, e?.message || e);
    }
  }
  return summary;
}

async function upsertLog(supabase, existing, row) {
  const payload = { ...row, handled_at: new Date().toISOString() };
  if (existing?.id) {
    const { error } = await supabase.from('lead_autoreply_log').update(payload).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('lead_autoreply_log').insert(payload);
    if (error) throw error;
  }
}

async function createLead(supabase, { lead, kind, settings, ownerUserId, now }) {
  const year = now.getUTCFullYear();
  const { data: refRows } = await supabase.from('projects').select('ref').like('ref', `SQ1-LD-${year}-%`).limit(500);
  const ref = nextLeadRef((refRows || []).map(r => r.ref), year);
  const id = 'lead_' + Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  const value = estimatedValue(kind, settings);
  const row = {
    id,
    ref,
    user_id: ownerUserId,
    stage: 'lead',
    project_type: 'party_wall',
    quote_status: 'draft',
    bo_1_name: lead.name || null,
    bo_1_email: lead.email || null,
    bo_phone: lead.phone || null,
    bo_premise_address: lead.postcode || null,
    works: lead.information || '',
    pw_lead_quote: { notes: leadNotes(lead, kind, settings), ...(value ? { estimated_value: value } : {}) },
  };
  const { data, error } = await supabase.from('projects').insert(row).select('id, ref').single();
  if (error) throw error;
  return data;
}
