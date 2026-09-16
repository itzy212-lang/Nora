import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code } = req.query;

    if (!code) {
      const error = req.query.error || 'unknown_error';
      return res.redirect(`/?auth=google&status=error&error=${encodeURIComponent(error)}`);
    }

    // Build redirect URI dynamically
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/api/google-callback`;

    console.log('[Google OAuth] Starting callback', { redirectUri, code: code.slice(0, 20) + '...' });

    // Step 1: Exchange authorization code for tokens
    console.log('[Google OAuth] Exchanging code for tokens...');
    const tokenResp = await axios.post(GOOGLE_TOKEN_URL, {
      code,
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const accessToken = tokenResp.data.access_token;
    const refreshToken = tokenResp.data.refresh_token;

    if (!accessToken) {
      throw new Error('No access token in OAuth response');
    }

    console.log('[Google OAuth] Got access token');

    // Step 2: Get user info from Google
    console.log('[Google OAuth] Fetching user info...');
    const userResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const googleEmail = userResp.data.email;
    console.log('[Google OAuth] User email:', googleEmail);

    // Step 3: Create Supabase client and find user
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    console.log('[Google OAuth] Querying auth.users...');
    const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers();

    if (listErr) {
      throw new Error(`Failed to list users: ${listErr.message}`);
    }

    const authUser = users?.find(u => u.email === googleEmail);
    if (!authUser) {
      throw new Error(`User ${googleEmail} not found in auth.users`);
    }

    console.log('[Google OAuth] Found user:', authUser.id);

    // Step 4: Insert/update tokens in user_integrations
    console.log('[Google OAuth] Upserting tokens...');
    const { data: insertData, error: insertErr } = await supabase
      .from('user_integrations')
      .upsert(
        {
          user_id: authUser.id,
          gmail_access_token: accessToken,
          gmail_refresh_token: refreshToken || null,
          google_drive_access_token: accessToken,
          google_drive_refresh_token: refreshToken || null,
          email_provider: 'gmail',
          storage_provider: 'googledrive',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (insertErr) {
      throw new Error(`Failed to save tokens: ${insertErr.message}`);
    }

    console.log('[Google OAuth] Success! Tokens saved.');

    // Redirect to app
    return res.redirect('/?auth=google&status=success');

  } catch (error) {
    console.error('[Google OAuth] Error:', {
      message: error.message,
      stack: error.stack,
      axiosCode: error.code,
      axiosResponse: error.response?.data,
    });

    const msg = error.message || 'Unknown error';
    return res.redirect(`/?auth=google&status=error&error=${encodeURIComponent(msg)}`);
  }
}
