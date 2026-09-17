-- Real, confirmed gap: there was no way for any user, including the
-- account this table was originally built for, to view or edit their
-- own AI drafting preferences through the app at all — only ever set
-- by writing directly to the database. Adds the field for a
-- "gold standard" reference email, and real RLS (previously enabled
-- with zero policies, meaning nobody — not even the account a row
-- belongs to — could read or write it through the normal app client).

ALTER TABLE user_brain ADD COLUMN IF NOT EXISTS gold_standard_email text;

CREATE POLICY user_brain_select ON user_brain FOR SELECT
  USING (user_id = (auth.uid())::text OR user_id = (auth.jwt() ->> 'email'::text));
CREATE POLICY user_brain_insert ON user_brain FOR INSERT
  WITH CHECK (user_id = (auth.uid())::text);
CREATE POLICY user_brain_update ON user_brain FOR UPDATE
  USING (user_id = (auth.uid())::text OR user_id = (auth.jwt() ->> 'email'::text));
