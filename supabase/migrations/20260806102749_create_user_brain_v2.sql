-- Repository record of an already-applied Supabase migration.
-- Live version: 20260806102749 "create_user_brain_v2".
-- This file exactly reproduces the applied SQL, recovered from
-- supabase_migrations.schema_migrations, so a fresh environment can
-- reproduce the live schema. Idempotent: CREATE TABLE IF NOT EXISTS.
--
-- One addition versus what was actually applied live: an explicit
-- ENABLE ROW LEVEL SECURITY statement. RLS is confirmed enabled on the
-- live table, but the originally-applied SQL (below, otherwise
-- unmodified) did not include that statement — its origin on the live
-- table was not established with certainty. Adding it explicitly here
-- ensures a fresh environment gets the same protected state rather than
-- depending on an unexplained mechanism. This does not change the
-- already-applied live migration; ALTER TABLE ... ENABLE ROW LEVEL
-- SECURITY is idempotent (a no-op if already enabled).

-- V2 user brain, entirely separate from the V1 `user_brain` table.
-- V1's api/ely-smart.js reads `user_brain` directly via get_ely_brain_v2 on every
-- request today (verified live before this migration) — this new table is never
-- referenced by that path, so V1 behaviour is unaffected by anything written here.
CREATE TABLE IF NOT EXISTS user_brain_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  identity_content text,
  voice_content text,
  banned_phrases text,
  gold_standard_framing text,
  fee_structure_content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_brain_v2 IS 'V2 authenticated user brain. Isolated from the V1 user_brain table by design (NORA_V2_IMPLEMENTATION_PLAN_V2.md correction 3) so V1 is never affected by V2 content.';

-- Added in this repository record (see note above) — idempotent.
ALTER TABLE public.user_brain_v2 ENABLE ROW LEVEL SECURITY;

-- Deliberately no anon/authenticated policies. RLS enabled with zero
-- policies means this table is reachable only via the service-role key
-- (used server-side by api/ely-smart.js) or the postgres role. This is
-- intentional: user_brain_v2 must never be directly reachable from the
-- browser. Do not add anon/authenticated policies without a documented,
-- separately-approved reason.
