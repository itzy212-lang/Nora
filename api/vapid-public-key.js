// api/vapid-public-key.js
//
// New endpoint (2026-08-14), fixing a real, confirmed key-mismatch bug:
// the frontend had the VAPID public key hardcoded directly in its
// source, completely disconnected from the actual VAPID_PUBLIC_KEY
// configured in Vercel — confirmed live, via a real 403 "Received
// unexpected response code" from the push service, meaning the two
// had drifted apart at some point. Rather than paste in a fresh
// hardcoded value (which would only reset the clock until it drifts
// again), the frontend now fetches the real, current key from here at
// registration time — this is the single source of truth going
// forward, matching whatever VAPID_PUBLIC_KEY actually is at any
// given moment.
export default function handler(req, res) {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: 'VAPID_PUBLIC_KEY not configured' });
  }
  return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}
