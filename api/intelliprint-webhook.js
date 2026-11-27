// api/intelliprint-webhook.js
//
// POST from Intelliprint (through Svix) whenever a letter changes. The request is checked against the signing
// secret (INTELLIPRINT_WEBHOOK_SECRET). We do not trust the event's own contents for the status: we find which
// print it is about, ask Intelliprint for that print's current state, and save that to posted_letters. That way
// the card is right whatever the event is called, and a forged or replayed event can change nothing.
// Always answers 200 once the signature is good, so Svix does not keep retrying events we cannot match.
import { createClient } from '@supabase/supabase-js';
import { verifySvixSignature, findPrintId, findLetterId } from './lib/svix-verify.js';
import { retrievePrint } from './lib/intelliprint.js';

export const config = { api: { bodyParser: false } };

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rawBody = await readRaw(req);
  const check = verifySvixSignature({ rawBody, headers: req.headers, secret: process.env.INTELLIPRINT_WEBHOOK_SECRET });
  if (!check.ok) {
    console.warn('[intelliprint-webhook] refused:', check.reason);
    return res.status(400).json({ error: 'Signature check failed' });
  }

  let event = {};
  try { event = JSON.parse(rawBody); } catch { return res.status(200).json({ ok: true, ignored: 'not JSON' }); }
  const printId = findPrintId(event);
  const letterId = findLetterId(event);
  // Logged (no addresses or secrets) so the real event names and shape are visible while this is new.
  console.log('[intelliprint-webhook] event', JSON.stringify({ type: event?.type ?? event?.event ?? null, keys: Object.keys(event || {}), data_keys: Object.keys(event?.data || {}), printId, letterId, status: event?.status ?? null, returned: event?.returned ?? null, shipped_date: event?.shipped_date ?? null }));
  if (!printId && !letterId) return res.status(200).json({ ok: true, ignored: 'no print or letter id' });

  // Match on the print id when the event has one, otherwise on the letter's own id.
  const column = printId ? 'provider_print_id' : 'provider_letter_id';
  const { data: row } = await supabase.from('posted_letters').select('id, tracking_number, status, provider_print_id').eq(column, printId || letterId).maybeSingle();
  if (!row) return res.status(200).json({ ok: true, ignored: 'not one of ours' });

  try {
    const print = await retrievePrint(process.env.INTELLIPRINT_API_KEY, row.provider_print_id || printId);
    const letter = print?.letters?.[0] || {};
    const tracking = letter.tracking_number || row.tracking_number;
    const status = letter.status || row.status;
    await supabase.from('posted_letters').update({ tracking_number: tracking, status, last_status_at: new Date().toISOString() }).eq('id', row.id);
    console.log('[intelliprint-webhook] status seen:', status);
    console.log('[intelliprint-webhook] updated', JSON.stringify({ id: row.id, status, hasTracking: !!tracking, shipped: letter.shipped_date ?? null }));
  } catch (err) {
    console.error('[intelliprint-webhook] refresh failed:', err.message);
    return res.status(500).json({ error: 'Could not refresh the letter' }); // let Svix retry
  }
  return res.status(200).json({ ok: true });
}
