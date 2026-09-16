import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_URI = process.env.VERCEL_ENV === 'production' 
  ? 'https://nora-d9wy.vercel.app/api/google-callback'
  : 'http://localhost:5173/api/google-callback';

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

    // Get the user from the access token (to get their user_id)
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const googleEmail = userRes.data.email;

    // Find the user by email in Supabase
    const { data: { users }, error: userErr } = await supabase.auth.admin.listUsers();
    const authUser = users?.find(u => u.email === googleEmail);

    if (!authUser) {
      throw new Error('User not found in Nora');
    }

    // Store tokens server-side (DO NOT expose to client)
    const { error: storeErr } = await supabase
      .from('user_integrations')
      .update({
        gmail_access_token: access_token,
        gmail_refresh_token: refresh_token || null,
        google_drive_access_token: access_token,
        google_drive_refresh_token: refresh_token || null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', authUser.id);

    if (storeErr) {
      throw new Error('Failed to store tokens: ' + storeErr.message);
    }

    // Redirect back with just a success status (NO tokens in URL)
    return res.redirect(`/?auth=google&status=success`);

  } catch (error) {
    console.error('Google OAuth callback error:', error.message);
    
    return res.redirect(
      `/?auth=google&status=error&error=${encodeURIComponent(error.message)}`
    );
  }
}
