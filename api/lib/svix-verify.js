// api/lib/svix-verify.js
//
// Checks that a webhook really came from Svix (the service Intelliprint sends its webhooks through).
// Svix signs every delivery: headers svix-id, svix-timestamp and svix-signature ("v1,<base64>" , several may be
// listed). The signature is HMAC-SHA256 of `${id}.${timestamp}.${rawBody}` using the endpoint's signing secret
// (shown as "whsec_<base64>"), base64 encoded. Timestamps more than 5 minutes old are refused (replay guard).
import crypto from 'node:crypto';

export const TOLERANCE_SECONDS = 5 * 60;

export function verifySvixSignature({ rawBody, headers = {}, secret, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!secret) return { ok: false, reason: 'no signing secret set' };
  const h = k => headers[k] ?? headers[k.toLowerCase()] ?? '';
  const id = h('svix-id'), timestamp = h('svix-timestamp'), signatures = h('svix-signature');
  if (!id || !timestamp || !signatures) return { ok: false, reason: 'missing signature headers' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp outside tolerance' };
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  for (const part of String(signatures).split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    const given = Buffer.from(sig, 'base64');
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: 'signature does not match' };
}

/** First string anywhere in the payload that looks like an Intelliprint print id (print_...). */
export function findPrintId(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (typeof value === 'string') return /^print_[A-Za-z0-9]+$/.test(value) ? value : null;
  if (Array.isArray(value)) { for (const v of value) { const f = findPrintId(v, depth + 1); if (f) return f; } return null; }
  if (typeof value === 'object') { for (const v of Object.values(value)) { const f = findPrintId(v, depth + 1); if (f) return f; } }
  return null;
}

/** First string anywhere in the payload that looks like an Intelliprint letter id (ltr_...). */
export function findLetterId(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (typeof value === 'string') return /^ltr_[A-Za-z0-9]+$/.test(value) ? value : null;
  if (Array.isArray(value)) { for (const v of value) { const f = findLetterId(v, depth + 1); if (f) return f; } return null; }
  if (typeof value === 'object') { for (const v of Object.values(value)) { const f = findLetterId(v, depth + 1); if (f) return f; } }
  return null;
}
