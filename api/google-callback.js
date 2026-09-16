export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { code } = req.query;
  if (!code) {
    const error = req.query.error || 'cancelled';
    return res.redirect(`/?auth=google&status=error&error=${encodeURIComponent(error)}`);
  }

  try {
    const axios = (await import('axios')).default;
    const { createClient } = await import('@supabase/supabase-js');

    console.log('[OAuth] Step 1: Exchange code');
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `${protocol}://${host}/api/google-callback`;

    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const accessToken = tokenResp.data.access_token;
    const refreshToken = tokenResp.data.refresh_token;
    console.log('[OAuth] Step 2: Got tokens', { 
      accessToken: accessToken ? `${accessToken.slice(0,20)}...` : 'MISSING',
      refreshToken: refreshToken ? 'yes' : 'no'
    });

    const userResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const googleEmail = userResp.data.email;
    console.log('[OAuth] Step 3: User email:', googleEmail);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const result = await supabase.auth.admin.listUsers();
    if (result.error) throw result.error;
    const user = result.data.users?.find(u => u.email === googleEmail);
    if (!user) throw new Error(`User ${googleEmail} not found`);
    console.log('[OAuth] Step 4: Found user:', user.id);

    console.log('[OAuth] Step 5: Saving tokens...');
    const saveData = {
      user_id: user.id,
      email_provider: 'gmail',
      storage_provider: 'googledrive',
      gmail_access_token: accessToken,
      gmail_refresh_token: refreshToken || null,
      google_drive_access_token: accessToken,
      google_drive_refresh_token: refreshToken || null,
      updated_at: new Date().toISOString(),
    };
    
    console.log('[OAuth] Upserting with data:', {
      user_id: saveData.user_id,
      email_provider: saveData.email_provider,
      storage_provider: saveData.storage_provider,
      gmail_access_token: saveData.gmail_access_token ? `${saveData.gmail_access_token.slice(0,20)}...` : 'NULL',
      google_drive_access_token: saveData.google_drive_access_token ? `${saveData.google_drive_access_token.slice(0,20)}...` : 'NULL',
    });

    const { error } = await supabase
      .from('user_integrations')
      .upsert(saveData, { onConflict: 'user_id' });

    if (error) throw error;

    console.log('[OAuth] Step 6: Success!');
    return res.redirect('/?auth=google&status=success');

  } catch (error) {
    console.error('[OAuth] FAILED:', error.message);
    return res.redirect(`/?auth=google&status=error&error=${encodeURIComponent(error.message)}`);
  }
}
