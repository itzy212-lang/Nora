// scripts/provision-user-brain-v2.mjs
//
// Provisions (or updates) one authenticated user's row in the isolated
// user_brain_v2 table, from a local, gitignored JSON file — never from
// content committed to this repository.
//
// Why this exists (see docs/nora-v2/PRIVATE_SEED_PROVISIONING.md for the
// full explanation): this repository is confirmed PUBLIC
// (github.com/itzy212-lang/nora, verified via the GitHub API before this
// script was written — "private": false). A user's identity, personal
// fee structure, and banned-phrase preferences are business-sensitive
// content that must never be committed to a public repository. This
// script lets the row be reproduced on any environment that has secure,
// out-of-band access to the real content — without that content ever
// touching git history.
//
// Usage:
//   node scripts/provision-user-brain-v2.mjs scripts/private/<file>.json
//
// Required environment variables (same ones api/ely-smart.js already
// requires — nothing new):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Required JSON file shape (see scripts/private/EXAMPLE.json.template
// for a non-sensitive, placeholder-only example of this exact shape):
// {
//   "user_id": "<real auth UUID>",
//   "identity_content": "...",
//   "voice_content": "...",
//   "banned_phrases": "...",
//   "banned_phrases_structured": { "general": [...], "domain_specific": {...}, "openers": [...], "closers": [...], "punctuation_and_formatting": [...] },
//   "gold_standard_framing": "...",
//   "fee_structure_content": "...",
//   "sign_off": "..."
// }
//
// This script is idempotent: it upserts by user_id (the table's UNIQUE
// constraint), so re-running it with updated content safely replaces the
// previous values for that user only — it never touches any other row,
// and never touches the V1 user_brain table.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/provision-user-brain-v2.mjs <path-to-private-json>');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const REQUIRED_FIELDS = ['user_id', 'identity_content', 'voice_content'];

async function main() {
  const raw = readFileSync(filePath, 'utf8');
  const record = JSON.parse(raw);

  const missing = REQUIRED_FIELDS.filter((f) => !record[f]);
  if (missing.length) {
    console.error(`Missing required field(s) in ${filePath}: ${missing.join(', ')}`);
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await sb
    .from('user_brain_v2')
    .upsert(
      {
        user_id: record.user_id,
        identity_content: record.identity_content,
        voice_content: record.voice_content,
        banned_phrases: record.banned_phrases || null,
        banned_phrases_structured: record.banned_phrases_structured || null,
        gold_standard_framing: record.gold_standard_framing || null,
        fee_structure_content: record.fee_structure_content || null,
        sign_off: record.sign_off || null,
      },
      { onConflict: 'user_id' }
    )
    .select('id, user_id, updated_at');

  if (error) {
    console.error('Provisioning failed:', error.message);
    process.exit(1);
  }

  console.log('Provisioned user_brain_v2 row:', data);
}

main();
