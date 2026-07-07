// api/capture-payload.js
// Captures the exact OpenAI payload for a Draft With Ely request.
// Called internally by ely-smart on every inbox_draft/draft_with_ely request.
// Remove once payload is captured.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  );

  try {
    const body = req.body;
    const { error } = await sb.from('debug_payloads').insert([{
      model: body.model || null,
      temperature: body.temperature ?? null,
      mode: body.mode || null,
      surface: body.surface || null,
      messages: body.messages || [],
      system_prompt_length: body.system_prompt_length || 0,
      total_messages: body.total_messages || 0,
      openai_response: body.openai_response || null,
    }]);
    if (error) {
      console.error('[capture-payload] insert error:', error.message);
      return res.status(500).json({ ok: false, error: error.message });
    }
    console.log('[capture-payload] payload saved');
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[capture-payload] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
