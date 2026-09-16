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
    // Import inside the function to catch any import errors
    const axios = (await import('axios')).default;
    const { createClient } = await import('@supabase/supabase-js');

    console.log('[OAuth] Starting');

    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/api/google-callback`;

    // Step 1: Exchange code
    console.log('[OAuth] Exchanging code');
    let tokenData;
    try {
      const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      tokenData = tokenResp.data;
    } catch (err) {
      throw new Error(`Token exchange failed: ${err.response?.data?.error || err.message}`);
    }

    const accessToken = tokenData.access_token;
    console.log('[OAuth] Got token');

    // Step 2: Get user
    console.log('[OAuth] Fetching user');
    let userData;
    try {
      const userResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      userData = userResp.data;
    } catch (err) {
      throw new Error(`User fetch failed: ${err.message}`);
    }

    console.log('[OAuth] Got user:', userData.email);

    // Step 3: Create Supabase client
    console.log('[OAuth] Creating Supabase client');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Step 4: Find user
    console.log('[OAuth] Finding user in auth');
    let users;
    try {
      const result = await supabase.auth.admin.listUsers();
      if (result.error) throw result.error;
      users = result.data.users;
    } catch (err) {
      throw new Error(`User lookup failed: ${err.message}`);
    }

    const user = users?.find(u => u.email === userData.email);
    if (!user) {
      throw new Error(`User ${userData.email} not found. Please sign up first.`);
    }

    console.log('[OAuth] Found user:', user.id);

    // Step 5: Save tokens
    console.log('[OAuth] Saving tokens');
    try {
      const { error } = await supabase.from('user_integrations').upsert({
        user_id: user.id,
        email_provider: 'gmail',
        storage_provider: 'googledrive',
        gmail_access_token: accessToken,
        gmail_refresh_token: tokenData.refresh_token || null,
        google_drive_access_token: accessToken,
        google_drive_refresh_token: tokenData.refresh_token || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      if (error) throw error;
    } catch (err) {
      throw new Error(`Token save failed: ${err.message}`);
    }

    console.log('[OAuth] Success!');
    return res.redirect('/?auth=google&status=success');

  } catch (error) {
    console.error('[OAuth] Error:', error.message, error.stack);
    const msg = error?.message || 'Unknown error';
    return res.redirect(`/?auth=google&status=error&error=${encodeURIComponent(msg)}`);
  }
}
