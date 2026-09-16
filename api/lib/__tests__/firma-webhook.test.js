import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifySignature } from '../../firma-webhook.js';

// Verifies against Firma's actual documented format, not just internal
// self-consistency — confirmed directly against their webhooks guide:
// header is "t=<unix ts>,v1=<hex digest>", digest is HMAC-SHA256 over
// "{timestamp}.{raw json body}". Fixed 2026-09-16 after finding the
// previous implementation didn't match this format at all.

const SECRET = 'whsec_test_secret_123';

function buildValidHeader(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${payload}`;
  const digest = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

describe('firma-webhook verifySignature — matches Firma\'s real documented format', () => {
  it('accepts a correctly-signed payload', () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'signing_request.completed' });
    const header = buildValidHeader(payload, SECRET);
    expect(verifySignature(payload, header, '', SECRET)).toBe(true);
  });

  it('rejects a tampered payload (signature computed for different body)', () => {
    const originalPayload = JSON.stringify({ id: 'evt_1', type: 'signing_request.completed' });
    const header = buildValidHeader(originalPayload, SECRET);
    const tamperedPayload = JSON.stringify({ id: 'evt_1', type: 'signing_request.cancelled' });
    expect(verifySignature(tamperedPayload, header, '', SECRET)).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const payload = JSON.stringify({ id: 'evt_1' });
    const header = buildValidHeader(payload, 'wrong_secret');
    expect(verifySignature(payload, header, '', SECRET)).toBe(false);
  });

  it('rejects a plain hex signature with no t=/v1= structure (the old, broken format)', () => {
    const payload = JSON.stringify({ id: 'evt_1' });
    const plainHex = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    expect(verifySignature(payload, plainHex, '', SECRET)).toBe(false);
  });

  it('accepts via X-Firma-Signature-Old during secret rotation grace period', () => {
    const payload = JSON.stringify({ id: 'evt_1' });
    const oldHeader = buildValidHeader(payload, SECRET);
    // Current header signed with a different (rotated) secret — should fail on its own
    const currentHeader = buildValidHeader(payload, 'new_rotated_secret');
    expect(verifySignature(payload, currentHeader, oldHeader, SECRET)).toBe(true);
  });

  it('skips verification entirely when no secret is configured (matches current, honest behaviour)', () => {
    const payload = JSON.stringify({ id: 'evt_1' });
    expect(verifySignature(payload, '', '', '')).toBe(true);
    expect(verifySignature(payload, 'garbage', '', '')).toBe(true);
  });

  it('rejects when a secret IS configured but no signature header is present at all', () => {
    const payload = JSON.stringify({ id: 'evt_1' });
    expect(verifySignature(payload, '', '', SECRET)).toBe(false);
  });
});
