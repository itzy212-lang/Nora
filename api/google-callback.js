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

    console.log('[OAuth] Exchanging code for tokens...');
    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    console.log('[OAuth] Full token response:', JSON.stringify(tokenResp.data, null, 2));

    const accessToken = tokenResp.data.access_token;
    const refreshToken = tokenResp.data.refresh_token;
    console.log('[OAuth] Step 2: Parsed tokens', { 
      accessToken: accessToken ? `${accessToken.slice(0,20)}...` : 'MISSING',
      accessTokenType: typeof accessToken,
      accessTokenLength: accessToken?.length,
      refreshToken: refreshToken ? `${refreshToken.slice(0,20)}...` : 'MISSING',
      refreshTokenType: typeof refreshToken,
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
    console.log('[OAuth] About to update with:', {
      user_id: user.id,
      email_provider: 'gmail',
      storage_provider: 'googledrive',
      gmail_access_token: accessToken ? `${accessToken.slice(0,20)}...` : 'NULL',
      gmail_refresh_token: refreshToken ? `${refreshToken.slice(0,20)}...` : 'NULL',
      google_drive_access_token: accessToken ? `${accessToken.slice(0,20)}...` : 'NULL',
      google_drive_refresh_token: refreshToken ? `${refreshToken.slice(0,20)}...` : 'NULL',
    });

    const updatePayload = {
      email_provider: 'gmail',
      storage_provider: 'googledrive',
      gmail_access_token: accessToken,
      gmail_refresh_token: refreshToken || null,
      google_drive_access_token: accessToken,
      google_drive_refresh_token: refreshToken || null,
      updated_at: new Date().toISOString(),
    };

    console.log('[OAuth] Payload keys:', Object.keys(updatePayload));
    
    const { error: updateError, data: updateData } = await supabase
      .from('user_integrations')
      .update(updatePayload)
      .eq('user_id', user.id)
      .select();

    console.log('[OAuth] Update result:', { error: updateError, dataReturned: !!updateData });
    if (updateError) throw updateError;

    console.log('[OAuth] Step 6: Success!');
    return res.redirect('/?auth=google&status=success');

  } catch (error) {
    console.error('[OAuth] FAILED:', error.message);
    return res.redirect(`/?auth=google&status=error&error=${encodeURIComponent(error.message)}`);
  }
}
