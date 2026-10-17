// Google access tokens for a user, from user_integrations (keyed by the user's
// UUID). Access tokens last about an hour and no expiry is stored, so - like
// sync-gmail.js and create-google-drive-folder.js - refresh whenever a refresh
// token exists, and fall back to the stored token if the refresh fails.

export async function getGoogleToken(sb, integ, kind /* 'gmail' | 'drive' */) {
  if (!integ) return null;
  const accessCol = kind === 'gmail' ? 'gmail_access_token' : 'google_drive_access_token';
  const refreshCol = kind === 'gmail' ? 'gmail_refresh_token' : 'google_drive_refresh_token';
  let token = integ[accessCol] || null;
  if (integ[refreshCol]) {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          refresh_token: integ[refreshCol],
          grant_type: 'refresh_token',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.access_token) {
        token = data.access_token;
        if (sb) await sb.from('user_integrations').update({ [accessCol]: token }).eq('user_id', integ.user_id);
      }
    } catch { /* use the stored token */ }
  }
  return token;
}
