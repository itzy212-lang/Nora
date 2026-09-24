// api/client-diagnostic.js
//
// Added 2026-09-24. Not a fix — instrumentation.
//
// After three deployed theories in a row (background auto-draft
// timing, re-embedded quote images, a SpeechRecognition race) none of
// which held up against a real "Aw, Snap!" mobile crash that's been
// reported at several different points in the Reply/Draft-with-Ely
// flow (mid-dictation, right after a draft is generated, on copy, on
// send), guessing from code and stored data has run out of road.
// This endpoint gives the client a cheap way to leave a real, timestamped
// trail on the server of what was actually happening right before each
// risky step — so whichever step it dies on next, there's genuine
// evidence to read afterward instead of a description reconstructed
// after the fact. Every call just gets console.logged (visible via
// Vercel runtime logs) — no DB write, no processing, so it can never
// itself be the thing that's slow or heavy.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const body = req.body || {};
    console.log('[client-diagnostic]', JSON.stringify({
      ts: new Date().toISOString(),
      ...body,
    }));
  } catch (err) {
    console.warn('[client-diagnostic] failed to log:', err?.message);
  }
  // 204 — nothing to return, and keeps the response itself negligible.
  res.status(204).end();
}
