// Chaser for Letters of Appointment that are still waiting for a signature.
//
// Signing is one person at a time. When the person whose turn it is has not
// signed 3 days after being invited, they get ONE reminder with the same secure
// link as the original email (so there is never an old and a new link in
// circulation). Anyone still waiting behind them gets a short
// note saying the appointment is outstanding and that their own link follows
// as soon as the person before them has signed. Sent through the same route as
// the original invitation (api/_lib/loa-email.js), so it is the same for every
// user. Each signer is chased once (loa_signers.chased_at).
import { createClient } from '@supabase/supabase-js';
import { loaToken, loaTokenHash, loaSignerToken } from './_lib/loa-signing.js';
import { sendLOAEmail } from './_lib/loa-email.js';

export const config = { maxDuration: 120 };

const CHASE_AFTER_DAYS = 3;
const host = process.env.LOA_SIGNING_BASE_URL || (process.env.VERCEL_ENV === 'production' ? 'https://loa.sq1consulting.co.uk' : 'https://' + process.env.VERCEL_URL);
const first = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';
const label = (type) => String(type || '').startsWith('bo_') ? 'Building Owner Letter of Appointment' : 'Adjoining Owners Letter of Appointment';

export function activeMessage(signer, request, link, replaced = false) {
  const lines = [
    'Hi ' + first(signer.name) + ',', '',
    'Just a quick reminder that your ' + label(request.appointment_type) + ' is still waiting for your signature.', '',
    (replaced ? 'Please use this secure link, which replaces the one sent before:' : 'Please use the same secure link as before:'), link,
  ];
  lines.push('', 'Kind regards,', 'Nora');
  return lines.join('\n');
}

export async function runLoaChase(sb, { now = new Date(), send = sendLOAEmail } = {}) {
  const cutoff = new Date(now.getTime() - CHASE_AFTER_DAYS * 86400000).toISOString();
  const { data: overdue, error } = await sb.from('loa_signers')
    .select('id,request_id,position,name,email,status,invited_at,chased_at,token_hash')
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

    // Resend the very same link as the original email whenever it can be worked
    // out (every LOA created from now on). Links made before that were random and
    // are only stored as a hash, so those few get a fresh link that replaces the old.
    let token = loaSignerToken(s.id);
    const replaced = !s.token_hash || loaTokenHash(token) !== s.token_hash;
    try {
      if (replaced) {
        token = loaToken();
        const { error: te } = await sb.from('loa_signers').update({ token_hash: loaTokenHash(token) }).eq('id', s.id);
        if (te) throw te;
      }
      const link = host + '/loa/sign/' + token;
      const sent = await send({ userId: request.user_id, to: [s.email], subject: 'Reminder: please sign your ' + label(request.appointment_type), text: activeMessage(s, request, link, replaced) });
      if (!sent?.sent) throw Error('reminder not delivered');
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
