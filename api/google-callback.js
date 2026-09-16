import axios from 'axios';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_URI = process.env.NODE_ENV === 'production' 
  ? 'https://nora-d9wy.vercel.app/api/google-callback'
  : 'http://localhost:5173/api/google-callback';

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
        `/auth-callback?status=error&error=${encodeURIComponent(error)}&description=${encodeURIComponent(errorDescription)}`
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

    // Redirect to app with tokens in URL (will be handled by app)
    const params = new URLSearchParams({
      status: 'success',
      access_token,
      refresh_token: refresh_token || '',
      expires_in,
    });

    return res.redirect(`/?auth=google&${params.toString()}`);

  } catch (error) {
    console.error('Google OAuth callback error:', error.message);
    
    return res.redirect(
      `/?auth=google&status=error&error=${encodeURIComponent(error.message)}`
    );
  }
}
