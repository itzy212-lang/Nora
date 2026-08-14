-- Repository record of an already-applied migration (2026-08-14).
-- Adds address to dispute_party_people, needed for the new mediation
-- agreement document generation (placeholders like PARTY_A_1_ADDRESS).
-- Per-person rather than per-party, since a multi-person party (e.g.
-- a couple) may have different addresses.
ALTER TABLE dispute_party_people ADD COLUMN IF NOT EXISTS address text;
COMMENT ON COLUMN dispute_party_people.address IS 'Added 2026-08-14 for mediation agreement document generation — per-person address, since a multi-person party (e.g. a couple) may have different addresses.';
