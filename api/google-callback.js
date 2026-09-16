export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.redirect('/?auth=google&status=error');

  try {
    const axios = (await import('axios')).default;
    const { createClient } = await import('@supabase/supabase-js');

    // Exchange code for tokens
    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: `https://${req.headers.host}/api/google-callback`,
      grant_type: 'authorization_code',
    });

    const accessToken = tokenResp.data.access_token;
    const refreshToken = tokenResp.data.refresh_token;

    // Get user email from Google
    const userResp = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Find user in Nora
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: users } = await supabase.auth.admin.listUsers();
    const user = users.find(u => u.email === userResp.data.email);
    if (!user) throw new Error('User not found');

    // Update user_integrations with tokens
    await supabase
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

    return res.redirect('/?auth=google&status=success');
  } catch (err) {
    return res.redirect(`/?auth=google&status=error&msg=${encodeURIComponent(err.message)}`);
  }
}
