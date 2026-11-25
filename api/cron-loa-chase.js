// Chaser for Letters of Appointment that are still waiting for a signature.
//
// Signing is one person at a time. When the person whose turn it is has not
// signed 3 days after being invited, they get ONE reminder with a fresh secure
// link (the earlier link is replaced, as links are stored only as a one-way
// hash and cannot be re-sent). Anyone still waiting behind them gets a short
// note saying the appointment is outstanding and that their own link follows
// as soon as the person before them has signed. Sent through the same route as
// the original invitation (api/_lib/loa-email.js), so it is the same for every
// user. Each signer is chased once (loa_signers.chased_at).
import { createClient } from '@supabase/supabase-js';
import { loaToken, loaTokenHash } from './_lib/loa-signing.js';
import { sendLOAEmail } from './_lib/loa-email.js';

export const config = { maxDuration: 120 };

const CHASE_AFTER_DAYS = 3;
const host = process.env.LOA_SIGNING_BASE_URL || (process.env.VERCEL_ENV === 'production' ? 'https://loa.sq1consulting.co.uk' : 'https://' + process.env.VERCEL_URL);
const first = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';
const label = (type) => String(type || '').startsWith('bo_') ? 'Building Owner Letter of Appointment' : 'Adjoining Owners Letter of Appointment';

export function activeMessage(signer, request, link, waiting) {
  const lines = [
    'Hi ' + first(signer.name) + ',', '',
    'Just a quick reminder that your ' + label(request.appointment_type) + ' is still waiting for your signature.', '',
    'Please use this secure link, which replaces the one sent before:', link,
  ];
  if (waiting.length) lines.push('', 'Once you have signed, ' + waiting.map((w) => w.name).join(' and ') + ' will be sent their own link.');
  lines.push('', 'Kind regards,', 'Nora');
  return lines.join('\n');
}

export function waitingMessage(signer, request, activeName) {
  return [
    'Hi ' + first(signer.name) + ',', '',
    'Just to let you know that the ' + label(request.appointment_type) + ' is still outstanding.', '',
    activeName + ' needs to sign first. As soon as they have, you will be sent your own secure link to sign.', '',
    'Kind regards,', 'Nora',
  ].join('\n');
}

export async function runLoaChase(sb, { now = new Date(), send = sendLOAEmail } = {}) {
  const cutoff = new Date(now.getTime() - CHASE_AFTER_DAYS * 86400000).toISOString();
  const { data: overdue, error } = await sb.from('loa_signers')
    .select('id,request_id,position,name,email,status,invited_at,chased_at')
    .in('status', ['invited', 'pending_verification']).is('chased_at', null).lt('invited_at', cutoff);
  if (error) throw error;

  const out = { chased: 0, failed: 0, requests: 0 };
  const seen = new Set();
  for (const s of overdue || []) {
    if (seen.has(s.request_id)) continue;
    seen.add(s.request_id);
    const { data: request } = await sb.from('loa_signing_requests').select('id,user_id,appointment_type,status').eq('id', s.request_id).maybeSingle();
    if (!request || ['completed', 'cancelled'].includes(request.status)) continue;

    // Claim first so two runs can never chase the same person twice.
    const { data: claimed } = await sb.from('loa_signers').update({ chased_at: now.toISOString() }).eq('id', s.id).is('chased_at', null).select('id').maybeSingle();
    if (!claimed) continue;

    const { data: all } = await sb.from('loa_signers').select('id,position,name,email,status').eq('request_id', s.request_id).order('position');
    const waiting = (all || []).filter((x) => x.status === 'waiting');
    const token = loaToken();
    try {
      const { error: te } = await sb.from('loa_signers').update({ token_hash: loaTokenHash(token) }).eq('id', s.id);
      if (te) throw te;
      const link = host + '/loa/sign/' + token;
      const jobs = [send({ userId: request.user_id, to: [s.email], subject: 'Reminder: please sign your ' + label(request.appointment_type), text: activeMessage(s, request, link, waiting) })];
      for (const w of waiting) jobs.push(send({ userId: request.user_id, to: [w.email], subject: 'Update on your ' + label(request.appointment_type), text: waitingMessage(w, request, s.name) }));
      const results = await Promise.allSettled(jobs);
      const activeSent = results[0].status === 'fulfilled' && results[0].value?.sent;
      if (!activeSent) throw Error('reminder not delivered');
      out.chased++; out.requests++;
    } catch (e) {
      console.error('[cron-loa-chase] failed for signer', s.id, e.message);
      await sb.from('loa_signers').update({ chased_at: null }).eq('id', s.id); // try again next run
      out.failed++;
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    return res.status(200).json({ success: true, ...(await runLoaChase(sb)) });
  } catch (e) {
    console.error('[cron-loa-chase]', e);
    return res.status(500).json({ error: e.message });
  }
}
