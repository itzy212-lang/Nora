// api/storage-file.js - read one file from the user's storage (OneDrive or Google
// Drive) as base64, in the {name,type,size,base64} shape the composers use.
// Capped at 3 MB (Vercel's 4.5 MB response limit, base64 adds a third).
import { createClient } from '@supabase/supabase-js';
import { getProviderContext } from './lib/provider-context.js';
import { getStorageAdapter } from './lib/storage-adapter.js';

export const MAX_FILE_BYTES = 3 * 1024 * 1024;
const sbClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user_id, user_uuid, item_id } = req.body || {};
    if ((!user_id && !user_uuid) || !item_id) return res.status(400).json({ error: 'user_id and item_id are required' });
    const ctx = await getProviderContext({ sb: sbClient(), userEmail: user_id, userUuid: user_uuid });
    const storage = await getStorageAdapter(ctx);
    const f = await storage.download(item_id);
    if (f.buffer.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'Too large to attach from here (over 3 MB) - attach it manually', name: f.name });
    return res.status(200).json({ name: f.name, type: f.mimeType, size: f.buffer.length, base64: f.buffer.toString('base64') });
  } catch (err) {
    console.error('[storage-file] failed:', err.message);
    return res.status(err.status || 500).json({ error: err.message });
  }
}
