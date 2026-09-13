// api/microsoft-oauth-callback.js
// Added 2026-09-12, on request: the real, working half of "Connect
// Outlook" that never existed. The old, deleted UI redirected to
// Microsoft's login correctly, but the redirect_uri it pointed back
// to (/auth/callback) was never handled anywhere in this app — no
// code ever exchanged the returned authorization code for real
// tokens. This endpoint is that missing piece: Microsoft redirects
// the popup window here directly (this IS the redirect_uri now),
// this exchanges the code server-side, fetches the connected
// mailbox's own address from Graph, saves the connection against the
// correct signed-in Nora user (carried through via the OAuth state
// parameter, not assumed), then returns a small HTML page that
// notifies the opener window and closes itself — completing the
// popup flow.

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function htmlResponse(res, { success, message }) {
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`<!DOCTYPE html>
<html><body style="font-family: -apple-system, sans-serif; padding: 40px; text-align: center; color: #1e293b;">
  <p>${success ? '✓ Connected' : '✗ ' + (message || 'Connection failed')}</p>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'ms-oauth-result', success: ${success ? 'true' : 'false'}, message: ${JSON.stringify(message || '')} }, '*');
    }
    setTimeout(() => window.close(), ${success ? 800 : 2500});
  </script>
</body></html>`);
}

export default async function handler(req, res) {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return htmlResponse(res, { success: false, message: error_description || error });
  }
  if (!code || !state) {
    return htmlResponse(res, { success: false, message: 'Missing authorization code' });
  }

  // state carries the signed-in Nora user's own identifier (their
  // email) through the OAuth round-trip — this is the standard way
  // to preserve context across a redirect Microsoft controls.
  const noraUserId = state;

  const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
  const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
  const TENANT_ID = process.env.MICROSOFT_TENANT_ID || 'common';
  const APP_BASE_URL = process.env.APP_BASE_URL || 'https://nora-d9wy.vercel.app';
  const REDIRECT_URI = `${APP_BASE_URL}/api/microsoft-oauth-callback`;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return htmlResponse(res, { success: false, message: 'Microsoft credentials not configured' });
  }

  try {
    // Exchange the authorization code for real tokens.
    const tokenRes = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        scope: 'offline_access Mail.ReadWrite Mail.Send User.Read',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return htmlResponse(res, { success: false, message: tokenData.error_description || 'Token exchange failed' });
    }

    // Fetch the actual connected mailbox's own address — this is
    // what gets synced, and may differ from the Nora account's own
    // login email.
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = await meRes.json();
    const mailboxAddress = me.mail || me.userPrincipalName || noraUserId;

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const sb = getSupabase();

    // Fixed 2026-09-12: saves against the actual signed-in user
    // (noraUserId, from state) — not a single, assumed account. Each
    // Nora user gets their own row here going forward.
    const { error: dbError } = await sb.from('email_accounts').upsert({
      user_id: noraUserId,
      email_address: mailboxAddress,
      provider: 'outlook',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt,
      reconnect_required: false,
      last_token_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

    if (dbError) {
      return htmlResponse(res, { success: false, message: dbError.message });
    }

    return htmlResponse(res, { success: true });
  } catch (err) {
    return htmlResponse(res, { success: false, message: err?.message || 'Unexpected error' });
  }
}
