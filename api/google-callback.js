import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.query;

  if (!code) {
    const error = req.query.error || 'cancelled';
    return res.redirect(`/?auth=google&status=error&error=${encodeURIComponent(error)}`);
  }

  try {
    console.log('[OAuth] Starting token exchange');
    
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/api/google-callback`;

    // Exchange code
    const { data: tokenData } = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const accessToken = tokenData.access_token;
    console.log('[OAuth] Got token');

    // Get user
    const { data: userData } = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    console.log('[OAuth] Got user:', userData.email);

    // Find user in Supabase
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const user = users?.find(u => u.email === userData.email);

    if (!user) {
      throw new Error(`User ${userData.email} not found`);
    }

    console.log('[OAuth] Found user:', user.id);

    // Save tokens
    await supabase.from('user_integrations').upsert({
      user_id: user.id,
      email_provider: 'gmail',
      storage_provider: 'googledrive',
      gmail_access_token: accessToken,
      gmail_refresh_token: tokenData.refresh_token || null,
      google_drive_access_token: accessToken,
      google_drive_refresh_token: tokenData.refresh_token || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    console.log('[OAuth] Tokens saved');
    return res.redirect('/?auth=google&status=success');

  } catch (error) {
    console.error('[OAuth] Error:', error.message);
    return res.redirect(`/?auth=google&status=error&error=${encodeURIComponent(error.message)}`);
  }
}
