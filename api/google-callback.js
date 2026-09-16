export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.redirect('/?auth=google&status=error&msg=no_code');

  try {
    const { createClient } = await import('@supabase/supabase-js');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Exchange code for tokens using native fetch (no axios dependency)
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: `https://${req.headers.host}/api/google-callback`,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();

    await supabase.from('oauth_debug').insert({
      event: 'token_response',
      response_data: tokenData,
    });

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    // Get user email from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = await userInfoRes.json();

    if (!userInfoRes.ok || !userInfo.email) {
      throw new Error('Failed to fetch Google user info');
    }

    // Find user in Nora
    const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;

    const user = usersData.users.find(u => u.email === userInfo.email);
    if (!user) throw new Error(`No Nora user found for ${userInfo.email}`);

    // Save tokens
    const { error: updateError } = await supabase
      .from('user_integrations')
      .update({
        email_provider: 'gmail',
        storage_provider: 'googledrive',
        gmail_access_token: accessToken,
        gmail_refresh_token: refreshToken || null,
        google_drive_access_token: accessToken,
        google_drive_refresh_token: refreshToken || null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (updateError) throw updateError;

    return res.redirect('/?auth=google&status=success');
  } catch (err) {
    console.error('[OAuth] FAILED:', err.message);
    return res.redirect(`/?auth=google&status=error&msg=${encodeURIComponent(err.message)}`);
  }
}
