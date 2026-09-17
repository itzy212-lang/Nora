-- Real, confirmed multi-user bug: document_templates had exactly one
-- row per template_key, shared and overwritable by every user of the
-- app — uploading a "replacement" LOA/notice/award template silently
-- overwrote the same file every other user was also using, with no
-- isolation and no fallback. Fixed by adding per-user ownership:
-- NULL owner_user_id = the shared system default (the existing 16
-- templates, all your firm's own SQ1 templates, become that default
-- automatically since the column defaults to NULL on existing rows).
-- A non-null owner_user_id is a specific user's own private override,
-- enforced by RLS so no user can read or write another user's
-- version. Resolution order (see useDocumentGenerator.js's
-- loadTemplate, generate-soc.js, DisputeResolution.jsx): a user's own
-- override if they have one, otherwise the system default.

ALTER TABLE document_templates ADD COLUMN IF NOT EXISTS owner_user_id text;

-- A pre-existing plain UNIQUE(template_key) constraint (from before
-- per-user ownership existed) blocks having more than one row per
-- template_key at all, which conflicts with this design entirely —
-- dropped in favour of the two partial indexes below, which express
-- the actual invariants correctly.
ALTER TABLE document_templates DROP CONSTRAINT IF EXISTS document_templates_template_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS document_templates_system_default_unique
  ON document_templates (template_key) WHERE owner_user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS document_templates_owner_unique
  ON document_templates (template_key, owner_user_id) WHERE owner_user_id IS NOT NULL;

DROP POLICY IF EXISTS "Allow authenticated read" ON document_templates;
DROP POLICY IF EXISTS "Allow anon read active templates" ON document_templates;
DROP POLICY IF EXISTS "Allow authenticated insert" ON document_templates;
DROP POLICY IF EXISTS "Allow authenticated update" ON document_templates;
DROP POLICY IF EXISTS "Allow authenticated delete" ON document_templates;

-- Read: system defaults (visible to everyone) + your own private overrides only.
CREATE POLICY document_templates_select ON document_templates
  FOR SELECT USING (
    owner_user_id IS NULL
    OR owner_user_id = (auth.uid())::text
    OR owner_user_id = (auth.jwt() ->> 'email')
  );

-- Insert: you may only create rows owned by yourself — never a
-- system default (owner_user_id IS NULL stays admin/service-role only,
-- maintained via api/update-notice-templates.js which uses the
-- service role key and bypasses RLS entirely).
CREATE POLICY document_templates_insert ON document_templates
  FOR INSERT WITH CHECK (
    owner_user_id = (auth.uid())::text
    OR owner_user_id = (auth.jwt() ->> 'email')
  );

-- Update/Delete: only your own rows — system defaults are read-only
-- to ordinary users.
CREATE POLICY document_templates_update ON document_templates
  FOR UPDATE USING (
    owner_user_id = (auth.uid())::text
    OR owner_user_id = (auth.jwt() ->> 'email')
  );
CREATE POLICY document_templates_delete ON document_templates
  FOR DELETE USING (
    owner_user_id = (auth.uid())::text
    OR owner_user_id = (auth.jwt() ->> 'email')
  );
