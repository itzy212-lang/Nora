-- Repository record of an already-applied migration (2026-08-14).
-- Adds a plain address column directly on dispute_parties, per direct
-- feedback that requiring a separate 'person' just to enter an
-- address for the ordinary single-person/company case was confusing
-- and contradictory-feeling. The party itself now carries its own
-- name/address/fee directly; 'people' under a party is now genuinely
-- optional, only for an actual additional named individual (e.g. a
-- couple), and starts empty rather than being pre-created.
ALTER TABLE dispute_parties ADD COLUMN IF NOT EXISTS address text;
COMMENT ON COLUMN dispute_parties.address IS 'Added 2026-08-14 — plain address directly on the party itself, for the ordinary single-person/company case. Feeds PARTY_A_ADDRESS_1/PARTY_B_ADDRESS_1 directly, no separate person needed.';
