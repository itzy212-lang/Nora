-- Repository record of an already-applied migration (2026-08-14).
-- Adds per-party fee and case-level mediation date/time, feeding
-- PARTY_A_FEE/PARTY_B_FEE/MEDIATION_DATE/MEDIATION_TIME in the
-- mediation agreement — the two remaining fields flagged as
-- uncollectible when checking the document against the app.
ALTER TABLE dispute_parties ADD COLUMN IF NOT EXISTS fee numeric;
COMMENT ON COLUMN dispute_parties.fee IS 'Added 2026-08-14 — this party''s fee for the mediation, feeds PARTY_A_FEE/PARTY_B_FEE in the mediation agreement.';

ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS mediation_date date;
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS mediation_time text;
COMMENT ON COLUMN dispute_cases.mediation_date IS 'Added 2026-08-14 — feeds MEDIATION_DATE in the mediation agreement.';
COMMENT ON COLUMN dispute_cases.mediation_time IS 'Added 2026-08-14 — feeds MEDIATION_TIME in the mediation agreement.';
