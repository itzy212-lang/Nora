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

  const { user_id, note } = req.body;
  if (!user_id || !note) {
    return res.status(400).json({ error: 'user_id and note required' });
  }

  // Get existing notes
  const { data: existing } = await supabase
    .from('user_brain')
    .select('brain_content')
    .eq('user_id', user_id)
    .single();

  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const newEntry = `[${date}] ${note}`;
  const updatedContent = existing?.brain_content
    ? existing.brain_content + '\n\n' + newEntry
    : newEntry;

  const { error } = await supabase
    .from('user_brain')
    .upsert({
      user_id,
      brain_content: updatedContent,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('[save-user-brain] error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[save-user-brain] appended note for user=${user_id}`);
  return res.status(200).json({ ok: true, user_id });
}
