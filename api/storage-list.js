// api/storage-list.js - list a folder in the user's storage (OneDrive or Google
// Drive, whichever they use). Added 2026-10-17 so folder pickers work the same
// for every account. POST {user_id (email), user_uuid, folder_id?}
import { createClient } from '@supabase/supabase-js';
import { getProviderContext } from './lib/provider-context.js';
import { getStorageAdapter } from './lib/storage-adapter.js';

const sbClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user_id, user_uuid, folder_id } = req.body || {};
    if (!user_id && !user_uuid) return res.status(400).json({ error: 'user_id is required' });
    const ctx = await getProviderContext({ sb: sbClient(), userEmail: user_id, userUuid: user_uuid });
    const storage = await getStorageAdapter(ctx);
    const items = await storage.list(folder_id || storage.rootId);
    return res.status(200).json({ success: true, provider: storage.provider, root_id: storage.rootId, root_label: storage.rootLabel, items });
  } catch (err) {
    console.error('[storage-list] failed:', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
}
