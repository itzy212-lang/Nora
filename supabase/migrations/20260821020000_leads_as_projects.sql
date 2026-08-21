-- Repository record of an already-applied migration (2026-08-21).
-- Leads restructured to be real project records from the start,
-- flagged rather than duplicated — requested directly, to fix the
-- exact double-entry problem the old, separate leads table caused.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'live';
COMMENT ON COLUMN projects.stage IS 'lead vs live. Accepting a lead''s quote flips this to live rather than copying data anywhere — same record throughout.';
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS pw_lead_quote jsonb;
COMMENT ON COLUMN projects.pw_lead_quote IS 'Party wall lead fee entry (num_aos, fee_notice, fee_soc, fee_agreed, fee_separate, discount_mode) and generated quote_ref, feeding the existing fee-proposal PDF generator and the lead pipeline total.';

-- The 6 existing rows in the old leads table were migrated into
-- projects with stage='lead' (or 'live' for the one already won),
-- preserving all contact/address/value data. The old leads table
-- itself was left in place, untouched, rather than dropped.
