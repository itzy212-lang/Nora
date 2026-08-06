# NORA V2 — PRIVATE SEED PROVISIONING

## The decision, and why

`itzy212-lang/nora` is a **public** repository — confirmed directly via the GitHub API before writing anything in this document (`GET /repos/itzy212-lang/nora` → `"private": false`, `"visibility": "public"`), not assumed.

Because of that, none of the following is committed to this repository, for any user, at any time:
- identity content (a specific person's name, practice, how to address them);
- personal writing-voice content tied to a real individual;
- personal or firm-specific fee structures;
- personal banned-phrase lists (these can reveal working relationships, past complaints, or firm-specific sensitivities).

This applies to Itzik's V2 row specifically. It also applies to any future user's row — the approach is general, not a one-off carve-out.

## What *is* committed, and why that's safe

- `scripts/provision-user-brain-v2.mjs` — the provisioning logic. Contains no data, only code: reads a local file, validates required fields, upserts into `user_brain_v2` by `user_id`. Safe to be public — it's the same shape of code as any other script in this repository.
- `scripts/user-brain-v2-template.json` — the required JSON shape, with placeholder values only (`"<who this user is...>"`, empty arrays). Safe to be public — it documents structure, not content.
- The two schema migrations for `user_brain_v2` (table creation, additive columns/trigger) — schema only, no row data.
- The `universal_brain_v2` / `default_voice_profile_v2` seed migration — this content is genuinely safe to publish: it's the platform's universal behavioural standard and default style, written to apply to any user, containing no one's personal identity, fees, or private preferences. The Olympia/Olivia example inside the Universal Brain is already anonymised for exactly this reason (no real names).

## What is *not* committed

`scripts/private/` — added to `.gitignore` in this same change. This is where the real, per-user JSON files live (e.g. `scripts/private/itzik.json`), matching the template's shape but with real content. This directory exists locally on whatever machine runs the provisioning script; it is never pushed, never part of git history.

## How to actually provision a user's V2 row

1. Copy `scripts/user-brain-v2-template.json` to `scripts/private/<name>.json` (this path is gitignored — confirm it doesn't appear in `git status` before proceeding).
2. Fill in the real values.
3. With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set in the environment (the same variables `api/ely-smart.js` already requires — nothing new to configure):
   ```
   node scripts/provision-user-brain-v2.mjs scripts/private/<name>.json
   ```
4. The script upserts by `user_id` — safe to re-run with updated content; it only ever touches that one user's row, and never touches the V1 `user_brain` table.

## Where the real content for Itzik's existing row actually lives right now

It is already live in the Supabase `user_brain_v2` table (provisioned directly during the V2 implementation work, prior to this documentation being written). This document and the script exist so that row can be **reproduced** — on a fresh environment, or after a genuine loss of the live database — without needing undocumented manual database edits, and without ever requiring that content to pass through this public repository.

## Honest limitation

This document does not itself contain a secure distribution mechanism for the private JSON file (e.g. a secrets manager integration) — that is a separate, environment-specific decision (password manager, secrets vault, encrypted transfer, or simply manual, careful handling for a single-operator practice like this one). What this approach guarantees is narrower and more important: **the private content will never end up in this repository's git history**, regardless of how it is otherwise stored or transferred.
