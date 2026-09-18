-- Real, confirmed gap: the SOC quality-audit step (runQualityAudit,
-- soc-pipeline.js) was permanently hardcoded to one shared gold-standard
-- example ("Square One Schedule of Condition Standard") for every user.
-- Adds a per-user override column, seeded for the working account with
-- an exact copy of that same content as its starting point — a
-- genuine no-op for that account, since the audit step now checks
-- this column first but finds identical content to what it already
-- used. New users get the same starting copy via the Settings UI
-- default; the shared constant in soc-pipeline.js remains the
-- fallback for anyone who never sets their own.

ALTER TABLE user_brain_v2 ADD COLUMN IF NOT EXISTS soc_gold_standard text;
