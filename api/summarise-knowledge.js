// api/summarise-knowledge.js
// One-off ingestion step for the "Your knowledge" box (26 Nov 2026): condenses an
// uploaded document into a short note the user then reviews and saves themselves.
// This is not a user-facing answer, so it is outside the single-call-per-request
// rule (NORA_V2_OPERATING_SYSTEM.md section 4); nothing is saved here.
import { modelFor } from './lib/model-config.js';
import { createClient } from '@supabase/supabase-js';
import { buildSummaryMessages } from './lib/user-knowledge.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verifyBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return error || !user?.id ? null : user.id;
}

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await verifyBearerToken(req);
  if (!userId) return res.status(401).json({ error: 'Please sign in again.' });

  const { text, filename } = req.body || {};
  if (!text || String(text).trim().length < 200) {
    return res.status(400).json({ error: 'There is not enough text in that file to summarise.' });
  }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: modelFor('project_memory').model,
        max_completion_tokens: modelFor('project_memory').maxCompletionTokens,
        messages: buildSummaryMessages(text, filename),
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'Could not summarise this file. Please try again.' });
    const data = await r.json();
    const summary = String(data.choices?.[0]?.message?.content || '').trim();
    if (!summary) return res.status(502).json({ error: 'Could not summarise this file. Please try again.' });
    return res.status(200).json({ success: true, summary });
  } catch (err) {
    console.error('[summarise-knowledge] error:', err.message);
    return res.status(500).json({ error: 'Could not summarise this file. Please try again.' });
  }
}
