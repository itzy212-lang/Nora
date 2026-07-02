import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, field, value } = req.body;
  if (!user_id || !field || value === undefined) {
    return res.status(400).json({ error: 'user_id, field and value required' });
  }

  // Only allow safe fields to be updated
  const ALLOWED_FIELDS = [
    'writing_voice', 'sign_off', 'fee_structure',
    'personal_preferences', 'banned_phrases'
  ];

  if (!ALLOWED_FIELDS.includes(field)) {
    return res.status(400).json({ error: 'Field not allowed' });
  }

  // Upsert — create row if doesn't exist
  const { error } = await supabase
    .from('user_brain')
    .upsert({
      user_id,
      [field]: value,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('[save-user-brain] error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[save-user-brain] saved field=${field} for user=${user_id}`);
  return res.status(200).json({ ok: true, field, user_id });
}
