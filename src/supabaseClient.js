import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://uttrmbmbmjszzfiftvco.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let _client = null;

export function getSupabaseClient(url, key) {
  const u = url || SUPABASE_URL;
  const k = key || SUPABASE_ANON_KEY;
  if (!u || !k) return null;
  if (_client) return _client;
  _client = createClient(u, k, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return _client;
}

export const sb = getSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export default sb;
