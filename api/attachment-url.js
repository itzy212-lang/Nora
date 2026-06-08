import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { storage_path } = req.body || {};
  if (!storage_path) return res.status(400).json({ error: 'storage_path required' });

  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data, error } = await sb.storage
      .from('email_attachments')
      .createSignedUrl(storage_path, 3600);

    if (error) throw error;
    return res.status(200).json({ url: data.signedUrl });
  } catch (err) {
    console.error('[attachment-url]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
