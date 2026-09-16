import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { access_token, refresh_token, user_id, provider } = req.body;

    if (!access_token || !user_id || !provider) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify user exists and is auth'd
    const { data: user, error: userErr } = await supabase.auth.admin.getUserById(user_id);
    if (userErr || !user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Store tokens in user_integrations
    const { error } = await supabase
      .from('user_integrations')
      .update({
        [`${provider}_access_token`]: access_token,
        [`${provider}_refresh_token`]: refresh_token || null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user_id);

    if (error) {
      console.error('DB error:', error);
      return res.status(500).json({ error: 'Failed to store tokens' });
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Store tokens error:', error);
    return res.status(500).json({ error: error.message });
  }
}
