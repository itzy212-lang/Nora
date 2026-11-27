// api/lib/intelliprint.js
//
// 27 Nov 2026. Thin client for Intelliprint's print API (https://api.intelliprint.net/v1).
// Request shape from their reference (POST /prints, form fields, key sent raw in the Authorization header):
//   file[content] + file[name] (base64 PDF), recipients[0][address][name|line|postcode|country],
//   postage[service], printing[double_sided], printing[black_and_white], confirmed, testmode, reference.
// Responses: cost.amount is pounds x 10^8; letters[].tracking_number is present for tracked services.
import { POSTAGE_SERVICE } from './letter-post.js';

export const INTELLIPRINT_BASE = 'https://api.intelliprint.net/v1';

/** Form fields for one tracked, single-sided letter. live=false sends it in test mode (not charged, not posted). */
export function buildPrintForm({ pdfB64, fileName = 'notice.pdf', name = '', line, postcode = '', reference = '', live = false, blackAndWhite = false, metadata = {} }) {
  const f = new FormData();
  f.set('type', 'letter');
  f.set('file[content]', pdfB64);
  f.set('file[name]', fileName);
  if (name) f.set('recipients[0][address][name]', name);
  f.set('recipients[0][address][line]', line);
  if (postcode) f.set('recipients[0][address][postcode]', postcode);
  f.set('recipients[0][address][country]', 'GB');
  f.set('postage[service]', POSTAGE_SERVICE);
  f.set('printing[double_sided]', 'no');
  f.set('printing[black_and_white]', blackAndWhite ? 'true' : 'false');
  if (reference) f.set('reference', reference);
  for (const [k, v] of Object.entries(metadata)) f.set(`metadata[${k}]`, String(v));
  f.set('testmode', live ? 'false' : 'true');
  f.set('confirmed', 'true');
  return f;
}

async function call(path, { apiKey, method = 'GET', body } = {}) {
  const res = await fetch(`${INTELLIPRINT_BASE}${path}`, { method, headers: { Authorization: apiKey }, body });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const message = json?.error?.message || json?.message || `Intelliprint returned ${res.status}`;
    const err = new Error(message); err.status = res.status; throw err;
  }
  return json;
}

export const createPrint = (apiKey, form) => call('/prints', { apiKey, method: 'POST', body: form });
export const retrievePrint = (apiKey, id) => call(`/prints/${encodeURIComponent(id)}`, { apiKey });
