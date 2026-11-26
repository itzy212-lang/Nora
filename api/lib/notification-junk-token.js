// Capability token for the "Junk" button on an email notification (26 Nov 2026).
//
// The phone's service worker has no login session, so the button cannot call an
// authenticated endpoint. Instead the push sent to the owner's own devices carries a
// token that is valid for ONE email only: HMAC(secret, "junk:" + email id). It can only
// move that single email to Junk (recoverable, nothing is permanently deleted), and only
// someone who received that push holds it.
import crypto from 'crypto';

function secret() {
  return process.env.SEND_EMAIL_PUSH_TRIGGER_SECRET || '';
}

export function makeJunkToken(emailId, key = secret()) {
  if (!emailId || !key) return null;
  return crypto.createHmac('sha256', key).update(`junk:${emailId}`).digest('hex');
}

export function verifyJunkToken(emailId, token, key = secret()) {
  const expected = makeJunkToken(emailId, key);
  if (!expected || !token) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(token), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
