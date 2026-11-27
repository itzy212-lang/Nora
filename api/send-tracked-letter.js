// api/send-tracked-letter.js
//
// POST /api/send-tracked-letter  (Authorization: Bearer <user token>)
// Posts a finished PDF (the notice pack) as a Tracked letter through Intelliprint and records it.
//   body: { pdf_b64, project_id, ao_id, recipient_name, address_line, postcode, expected_price_pence, file_name }
// - Page count comes from the PDF itself (never from the client), so attachments are always counted.
// - Price (what we charge, ex VAT) comes from api/lib/letter-post.js. If the client's previewed price
//   differs from the server's, nothing is sent.
// - TEST MODE unless INTELLIPRINT_LIVE=1 is set on Vercel: Intelliprint then neither charges nor posts.
// Provider-neutral: depends on no email or storage provider.
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import { MAX_SHEETS, letterPriceBreakdown, letterCostPence, royalMailTrackingUrl, costToPence } from './lib/letter-post.js';
import { buildPrintForm, createPrint } from './lib/intelliprint.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function userIdFrom(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return error || !user?.id ? null : user.id;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await userIdFrom(req);
  if (!userId) return res.status(401).json({ error: 'Not signed in' });

  const apiKey = process.env.INTELLIPRINT_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Letter posting is not set up yet' });

  const { pdf_b64, project_id, ao_id, recipient_name, address_line, postcode, expected_price_pence, file_name } = req.body || {};
  if (!pdf_b64 || !String(address_line || '').trim()) return res.status(400).json({ error: 'A PDF and a postal address are needed' });
  if (!String(postcode || '').trim()) return res.status(400).json({ error: 'A postcode is needed so Royal Mail can deliver it' });

  let sheets;
  try {
    const doc = await PDFDocument.load(Buffer.from(pdf_b64, 'base64'), { ignoreEncryption: true });
    sheets = doc.getPageCount();
  } catch {
    return res.status(400).json({ error: 'That PDF could not be read' });
  }
  if (sheets > MAX_SHEETS) return res.status(400).json({ error: `A letter can have at most ${MAX_SHEETS} pages; this one has ${sheets}` });

  const price = letterPriceBreakdown(sheets);
  if (Number.isFinite(Number(expected_price_pence)) && Number(expected_price_pence) !== price.net) {
    return res.status(409).json({ error: 'The price has changed since you looked. Please check it again.', sheets, price });
  }

  const live = process.env.INTELLIPRINT_LIVE === '1';
  try {
    const form = buildPrintForm({
      pdfB64: pdf_b64, fileName: file_name || 'notice.pdf', name: recipient_name || '',
      line: String(address_line).trim(), postcode: String(postcode).trim(), live,
      reference: `Nora ${project_id || ''} ${ao_id || ''}`.trim().slice(0, 100),
      blackAndWhite: process.env.INTELLIPRINT_BLACK_AND_WHITE === '1',
      addressInDocument: process.env.INTELLIPRINT_ADDRESS_IN_DOCUMENT === '1',
      metadata: { nora_user: userId, nora_project: project_id || '', nora_ao: ao_id || '' },
    });
    const print = await createPrint(apiKey, form);
    const letter = print?.letters?.[0] || {};
    const theirCost = costToPence(letter.cost || print.cost);
    const ourCost = letterCostPence(sheets);
    const tracking = letter.tracking_number || null;

    const { data: row, error: insertErr } = await supabase.from('posted_letters').insert({
      user_id: userId, project_id: project_id ? String(project_id) : null, ao_id: ao_id ? String(ao_id) : null,
      recipient_name: recipient_name || null, recipient_address: `${address_line}, ${postcode}`,
      sheets, price_net_pence: price.net, vat_pence: price.vat, cost_net_pence: theirCost ?? ourCost,
      provider_print_id: print.id || null, tracking_number: tracking, status: letter.status || 'draft', testmode: !live,
      last_status_at: new Date().toISOString(),
    }).select('id').single();
    if (insertErr) console.error('[send-tracked-letter] could not record letter:', insertErr.message);

    // If Intelliprint's cost differs from what we expect, say so in the logs so the price can be corrected.
    if (theirCost != null && live && theirCost !== ourCost) console.warn(`[send-tracked-letter] cost mismatch: expected ${ourCost}p, Intelliprint charged ${theirCost}p for ${sheets} sheets`);

    return res.status(200).json({
      ok: true, testmode: !live, id: row?.id || null, sheets, price,
      tracking_number: tracking, tracking_url: royalMailTrackingUrl(tracking),
      provider_cost_pence: theirCost, status: letter.status || 'draft',
    });
  } catch (err) {
    console.error('[send-tracked-letter] failed:', err.message);
    return res.status(502).json({ error: `The letter could not be sent: ${err.message}` });
  }
}
