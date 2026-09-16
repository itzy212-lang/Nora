import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  // Handle CORS
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
    const { code, state } = req.query;

    if (!code) {
      // User denied or error
      const error = req.query.error || 'unknown_error';
      const errorDescription = req.query.error_description || 'Authorization failed';
      
      return res.redirect(
        `/?auth=google&status=error&error=${encodeURIComponent(error)}&description=${encodeURIComponent(errorDescription)}`
      );
    }

    // Dynamically construct redirect URI from request origin
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const REDIRECT_URI = `${protocol}://${host}/api/google-callback`;

    console.log('Google OAuth: Exchanging code for tokens...', { REDIRECT_URI });

    // Exchange code for tokens
    const tokenResponse = await axios.post(GOOGLE_TOKEN_URL, {
      code,
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!access_token) {
      throw new Error('No access token in response');
    }

    console.log('Google OAuth: Got access token, fetching user info...');

    // Get the user from the access token
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const googleEmail = userRes.data.email;
    console.log('Google OAuth: User email:', googleEmail);

    // Find the user by email in Supabase auth
    const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers();
    
    if (listErr) {
      throw new Error('Failed to list users: ' + listErr.message);
    }

    const authUser = users?.find(u => u.email === googleEmail);

    if (!authUser) {
      throw new Error(`User not found in Nora. Expected to find: ${googleEmail}`);
    }

    console.log('Google OAuth: Found user:', authUser.id);

    // Store tokens using UPSERT (insert if not exists, update if exists)
    const { data: upsertResult, error: storeErr } = await supabase
      .from('user_integrations')
      .upsert({
        user_id: authUser.id,
        gmail_access_token: access_token,
        gmail_refresh_token: refresh_token || null,
        google_drive_access_token: access_token,
        google_drive_refresh_token: refresh_token || null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id'
      });

    if (storeErr) {
      throw new Error('Failed to store tokens: ' + storeErr.message);
    }

    console.log('Google OAuth: Tokens stored successfully');

    // Redirect back with just a success status (NO tokens in URL)
    return res.redirect(`/?auth=google&status=success`);

  } catch (error) {
    console.error('Google OAuth callback error:', {
      message: error.message,
      code: error.code,
      response: error.response?.data
    });
    
    return res.redirect(
      `/?auth=google&status=error&error=${encodeURIComponent(error.message)}`
    );
  }
}
