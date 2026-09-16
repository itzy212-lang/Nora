export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.redirect('/?auth=google&status=error');

  try {
    const axios = (await import('axios')).default;
    const { createClient } = await import('@supabase/supabase-js');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Exchange code for tokens
    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: `https://${req.headers.host}/api/google-callback`,
      grant_type: 'authorization_code',
    });

    // Log what Google returned
    await supabase.from('oauth_debug').insert({
      event: 'token_response',
      response_data: tokenResp.data
    });

    const accessToken = tokenResp.data.access_token;
    const refreshToken = tokenResp.data.refresh_token;

    // Get user email from Google
    const userResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    await supabase.from('oauth_debug').insert({
      event: 'user_response',
      response_data: { email: userResp.data.email }
    });

    // Find user in Nora
    const { data: users } = await supabase.auth.admin.listUsers();
    const user = users.find(u => u.email === userResp.data.email);
    if (!user) throw new Error('User not found');

    await supabase.from('oauth_debug').insert({
      event: 'before_update',
      response_data: { 
        user_id: user.id,
        has_access_token: !!accessToken,
        has_refresh_token: !!refreshToken
      }
    });

    // Update user_integrations with tokens
    const updateResult = await supabase
      .from('user_integrations')
      .update({
        email_provider: 'gmail',
        storage_provider: 'googledrive',
        gmail_access_token: accessToken,
        gmail_refresh_token: refreshToken,
        google_drive_access_token: accessToken,
        google_drive_refresh_token: refreshToken,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    await supabase.from('oauth_debug').insert({
      event: 'after_update',
      response_data: updateResult
    });

    return res.redirect('/?auth=google&status=success');
  } catch (err) {
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      await supabase.from('oauth_debug').insert({
        event: 'error',
        response_data: { message: err.message }
      });
    } catch (e) {}
    
    return res.redirect(`/?auth=google&status=error&msg=${encodeURIComponent(err.message)}`);
  }
}
