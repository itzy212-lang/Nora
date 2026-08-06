# NORA V2 — RECONCILIATION RECORD

Three-way diff, run against live/repository sources on 2026-08-06.

Sources:
- `ely_master_v3_backup_20260624` (Supabase, `ai_instruction_sets`, inactive, byte-recovered) — 19,395 chars.
- `e4cbd4324cbec45d3f5d24bfb7032f3e23d0156c` (git commit, `api/ely-smart.js`, 2026-07-10, "benchmark brain — 4 final additions") — code-level draft block, not this row.
- Live `ely_master_v3` (Supabase, `ai_instruction_sets`, active) — 22,291 chars, last modified 2026-07-31.

`behaviour_rules` and `output_rules` fields: byte-identical between the June-24 backup and today's live row. Only `system_prompt` diverges.

## Classification of every difference

| Addition | Classification | Disposition |
|---|---|---|
| Name genericisation (Itzik → "the authenticated user") | architectural, misapplied | Specific proven wording restored to User Brain V2; generic replacement not imported as new value |
| PARTY WALL TERMINOLOGY section | unevaluated, domain-specific | Held out; Domain Knowledge candidate for separate future review |
| Banned "serviceable" phrases | unevaluated, surface-specific | Held out; SOC-surface candidate for separate future review |
| PROACTIVE KNOWLEDGE USE section | duplicate | Excluded — `e4cbd432`'s PROFESSIONAL REGISTER already covers this ground, once, approved |
| PARAGRAPH BREAKS — SHORT CONFIRMATORY REPLIES | unevaluated | Held out; good future candidate, not imported without evidence |

## Baseline adopted for Universal Brain V2

June-24 backup content, plus the six approved `e4cbd432` additions (PRIMARY DRAFTING OBJECTIVE, ARGUMENT FIRST, CASE CONSTRUCTION, FACTUAL ACCURACY RULE, FINAL FACT VERIFICATION, PROFESSIONAL REGISTER), each added once. Nothing from the 11–31 July drift is imported by default.
