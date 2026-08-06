# supabase/migrations — README

## This is the first migration convention established in this repository

Before this change, `list_migrations` on the live Supabase project showed **130 applied migrations**, none of them represented anywhere in this git repository. Every prior schema change in this project's history was applied directly (via the Supabase Management API or SQL editor), not tracked in version control. This directory does not replace or reconcile that entire history — it establishes the standard Supabase CLI convention (`supabase/migrations/<timestamp>_<name>.sql`) going forward, starting with the three files that represent the V2 `user_brain_v2` work.

**Honest scope limit:** a fresh Supabase project built from *only* this repository's migrations would get `user_brain_v2` and the two V2 seed rows correctly — it would **not** get the other ~130 pre-existing tables, functions, and rows (`projects`, `emails`, `ai_instruction_sets` itself as a table, `get_ely_brain_v2`, etc.) that the whole rest of Nora depends on. That gap predates this work and is far larger in scope than what this task set out to fix. It is disclosed here so nobody mistakes "V2's migrations are now tracked" for "this repository can rebuild the full database from scratch" — it cannot, yet.

## The three files here, and what each represents

| File | Live migration version it matches | What it does |
|---|---|---|
| `20260806102749_create_user_brain_v2.sql` | `20260806102749` (already applied) | Creates `user_brain_v2`. One addition versus the original applied SQL: an explicit `ENABLE ROW LEVEL SECURITY` statement — see the file's own comment for why. |
| `20260806105856_user_brain_v2_additive_columns_and_trigger.sql` | `20260806105856` (already applied) | Adds `sign_off`, `banned_phrases_structured`, and the `updated_at` trigger. Additive only. |
| `20260806120000_seed_universal_brain_v2_and_default_voice_profile_v2.sql` | none — these rows were inserted directly, not via `apply_migration`, so no corresponding live migration entry exists | Idempotent seed (`ON CONFLICT (name) DO NOTHING`) for the two universal V2 content rows. |

## A fourth live migration entry exists and is deliberately *not* represented here

`20260806103824` "create_user_brain_v2" is real, in the live migration history, but it applied `CREATE TABLE IF NOT EXISTS` against a schema that already existed (from `20260806102749`, applied 11 minutes earlier) — it was a genuine no-op, changed nothing. It is **not** given a corresponding file in this directory, because doing so would mean committing the schema design it originally specified — which was a different, earlier, superseded design (a single free-text `brain_content` blob, no RLS statement) than what is actually live today. Representing it as a real migration file would make a fresh environment build the *wrong* schema. This is disclosed here rather than silently omitted.

## Applying these to a project that already has the live changes

Because `20260806102749` and `20260806105856` are already applied live, running these files again via the Supabase CLI against that *same* project should be a safe no-op — every statement in both files is idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS` before `CREATE`). If the CLI's own migration-tracking table doesn't recognise these versions as already applied (since they were originally applied via `apply_migration`, not `supabase db push`), a baseline/repair step may be needed — for example `supabase migration repair --status applied 20260806102749 20260806105856` — before running `supabase db push` for the first time against this project, so the CLI doesn't attempt to re-run something it doesn't realise already happened. This has not been done as part of this task; flagged as a required step before this project's migrations are managed via the CLI going forward.
