-- Repository record of an already-applied migration (2026-08-21).
-- Proper quote versioning for PM/construction projects — requested
-- directly, with a real workflow in mind: original scope gets
-- accepted and numbered, then a later variation needs its own,
-- genuinely separate quote and number, without disturbing the first.
CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  quote_number integer,
  status text NOT NULL DEFAULT 'draft',
  label text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  generated_at timestamptz
);
COMMENT ON TABLE quotes IS 'Each row is one distinct, tabbed quote (original scope, a later variation, etc.), with its own quote number assigned once on first generation and reused on every regeneration after that.';
CREATE INDEX idx_quotes_project ON quotes(project_id);

ALTER TABLE scope_items ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_scope_items_quote ON scope_items(quote_id);

-- Existing scope items on the two projects that had them at the time
-- of this migration were backfilled into a "first quote" row each,
-- carrying forward their existing draft/accepted status. No prior
-- quote number existed to carry forward (the old system never
-- persisted one per project), so both start unissued and get a real,
-- tracked number the next time they're generated under the new system.

-- Fixed 2026-08-21 (same day, follow-up): the quotes table above was
-- created with row-level security enabled by default and zero
-- policies ever added — meaning every read/write from the actual app
-- was silently blocked the whole time. Disabled RLS to match every
-- other table in this single-tenant app (scope_items included).
ALTER TABLE quotes DISABLE ROW LEVEL SECURITY;
