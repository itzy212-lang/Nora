// api/lib/letter-post.js
//
// 27 Nov 2026. Tracked letters posted through Intelliprint (hybrid mail). Pure helpers only: price,
// limits and the Royal Mail tracking link. Nothing here talks to Intelliprint or any storage/mail
// provider, so it works the same for every user (Outlook or Gmail, OneDrive or Google Drive).
//
// Service: one option only, "Tracked" (Intelliprint postage.service = 'tracked_48'), printed single-sided.
// What the customer is charged (before VAT): £3.32 for the first sheet (envelope, print and postage included)
// plus 6p for each extra sheet. Single-sided, so one page = one sheet. Intelliprint's own cost is £3.22 plus
// 6p per extra sheet, so the margin is 10p a letter. Change the numbers here only.

export const POSTAGE_SERVICE = 'tracked_48';
export const MAX_SHEETS = 50;                 // Intelliprint's limit per letter
export const FIRST_SHEET_PENCE = 332;         // charged to the customer, ex VAT
export const EXTRA_SHEET_PENCE = 6;
export const OUR_COST_FIRST_SHEET_PENCE = 322; // what Intelliprint charges us, ex VAT
export const OUR_COST_EXTRA_SHEET_PENCE = 6;
export const VAT_RATE = 0.2;

function checkSheets(sheets) {
  const n = Number(sheets);
  if (!Number.isInteger(n) || n < 1) throw new Error('A letter needs at least one page');
  if (n > MAX_SHEETS) throw new Error(`A letter can have at most ${MAX_SHEETS} pages`);
  return n;
}

/** What the customer pays, in pence, before VAT. */
export function letterPricePence(sheets) {
  const n = checkSheets(sheets);
  return FIRST_SHEET_PENCE + (n - 1) * EXTRA_SHEET_PENCE;
}

/** What it costs us, in pence, before VAT (for our own margin records). */
export function letterCostPence(sheets) {
  const n = checkSheets(sheets);
  return OUR_COST_FIRST_SHEET_PENCE + (n - 1) * OUR_COST_EXTRA_SHEET_PENCE;
}

/** Price breakdown in pence: { net, vat, gross }. VAT is rounded to the nearest penny. */
export function letterPriceBreakdown(sheets) {
  const net = letterPricePence(sheets);
  const vat = Math.round(net * VAT_RATE);
  return { net, vat, gross: net + vat };
}

export const formatPounds = pence => `£${(pence / 100).toFixed(2)}`;

/** Royal Mail's tracking page for a tracking number, already filled in. */
export function royalMailTrackingUrl(trackingNumber) {
  const t = String(trackingNumber || '').replace(/\s+/g, '');
  if (!t) return null;
  return `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(t)}`;
}

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/** Splits "12 High St, London N1 2AB" into { line: '12 High St, London', postcode: 'N1 2AB' }. No postcode found: postcode is ''. */
export function splitUkPostcode(address) {
  const text = String(address || '').replace(/\s+/g, ' ').trim();
  const m = text.match(UK_POSTCODE);
  if (!m) return { line: text.replace(/[,\s]+$/, ''), postcode: '' };
  const postcode = `${m[1]} ${m[2]}`.toUpperCase();
  const line = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').replace(/[,\s]+$/, '').replace(/^[,\s]+/, '');
  return { line, postcode };
}

/** Intelliprint cost objects are integers scaled by 10^8 (pounds). Returns pence, or null. */
export function costToPence(cost) {
  const n = Number(cost?.amount);
  return Number.isFinite(n) ? Math.round(n / 1e6) : null;
}

/**
 * Plain-English label for the status Intelliprint reports for a letter. Their exact wording is matched loosely
 * (by keyword) and anything unrecognised is shown as they sent it, so a new status never hides the letter.
 * `final` means it will not change again, so the card can stop asking Intelliprint.
 */
export function letterStatusLabel(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return { label: 'Accepted', final: false };
  if (/deliver/.test(s)) return { label: 'Delivered', final: true };
  if (/cancel/.test(s)) return { label: 'Cancelled', final: true };
  if (/reject|fail|error|return|undeliver|invalid/.test(s)) return { label: 'Not accepted', final: true };
  // Intelliprint's real first status for a live letter is "waiting_to_print": ordered, accepted, not printed yet.
  if (/wait|pending|queue|draft|accept|confirm|process/.test(s)) return { label: 'Accepted, waiting to print', final: false };
  if (/printing/.test(s)) return { label: 'Being printed', final: false };
  if (/post|dispatch|despatch|mail|sent|ship/.test(s)) return { label: 'Posted', final: false };
  if (/print/.test(s)) return { label: 'Printed', final: false };
  return { label: String(raw), final: false };
}
