import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Canonical user UUID — always write here regardless of what identifier the
// frontend passes. This matches the hardcoded value in get_ely_brain_v2 and
// prevents the email-keyed row from accumulating content that is never read.
const CANONICAL_USER_ID = '3bd1f331-e8ce-477a-8a5d-c5dcdd901434';

// ── Content validation ────────────────────────────────────────────────────
// Only structured, long-term preferences should ever be written to user_brain.
// Dictation fragments, working drafts, conversational turns and case-specific
// notes must be rejected here — they contaminate every prompt if saved.

const ALLOWED_TYPES = new Set([
  'writing_preference',   // e.g. voice, tone, style
  'fee_structure',        // fee rates, format rules
  'banned_phrase',        // words/phrases to avoid
  'terminology',          // preferred terms, spelling
  'sign_off',             // sign-off format
  'format_rule',          // structural preferences
  'personal_preference',  // stable personal preferences
]);

// Phrases that indicate the note is a dictation fragment or working draft
const DICTATION_PATTERNS = [
  /^let'?s\s/i,
  /^let me\s/i,
  /current working draft/i,
  /^hi\s+\w+,/i,           // starts like an email greeting
  /^dear\s+\w+/i,
  /kind regards/i,
  /^I've?\s+(managed|spoken|heard|tried|just)/i,
  /^I'd?\s+like\s+to\s+draft/i,
  /^respond\s+to/i,
  /^draft\s+(a|an|the|this)/i,
  /apologies\s+for\s+the\s+delay/i,
  /^without\s+prejudice/i,
  /^I\s+already\s+responded/i,
];

function isValidMemory(type, note) {
  // Must be a recognised type
  if (!ALLOWED_TYPES.has(type)) {
    return { valid: false, reason: `Unknown memory type: ${type}. Allowed: ${[...ALLOWED_TYPES].join(', ')}` };
  }

  // Must not look like dictation or a working draft
  const trimmed = (note || '').trim();
  for (const pattern of DICTATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: 'Note appears to be dictation, a working draft, or a conversational turn. Only stable long-term preferences should be saved to user memory.' };
    }
  }

  // Must be reasonably concise — long notes are likely drafts or transcripts
  if (trimmed.length > 800) {
    return { valid: false, reason: 'Note is too long to be a stable preference (max 800 chars). Working drafts and transcripts must not be saved to user memory.' };
  }

  return { valid: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { note, type = 'personal_preference' } = req.body;

  if (!note) {
    return res.status(400).json({ error: 'note is required' });
  }

  // Validate before writing
  const validation = isValidMemory(type, note);
  if (!validation.valid) {
    console.warn('[save-user-brain] rejected note:', validation.reason, '| note preview:', String(note).slice(0, 80));
    return res.status(422).json({ error: validation.reason, rejected: true });
  }

  // Always write to canonical UUID row — ignore any user_id from the request
  const user_id = CANONICAL_USER_ID;

  // Get existing content
  const { data: existing } = await supabase
    .from('user_brain')
    .select('brain_content')
    .eq('user_id', user_id)
    .single();

  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const newEntry = `[${date}] [${type}] ${note.trim()}`;
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

  console.log(`[save-user-brain] saved [${type}] for user=${user_id}`);
  return res.status(200).json({ ok: true, type });
}
