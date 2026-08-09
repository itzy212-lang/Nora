import { createClient } from '@supabase/supabase-js';

const MEDIATION_SUPABASE_URL = process.env.MEDIATION_SUPABASE_URL;
const MEDIATION_SUPABASE_SERVICE_ROLE_KEY = process.env.MEDIATION_SUPABASE_SERVICE_ROLE_KEY;

function getMediationSupabase() {
  if (!MEDIATION_SUPABASE_URL || !MEDIATION_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Mediation backend is not configured');
  }

  return createClient(MEDIATION_SUPABASE_URL, MEDIATION_SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export { getMediationSupabase };
