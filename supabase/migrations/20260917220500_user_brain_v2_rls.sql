-- Real, confirmed gap, same pattern as several other tables found
-- tonight: user_brain_v2 had RLS enabled with zero policies attached
-- — meaning nobody, not even the account a row belongs to, could
-- read or write it through the normal app client. This is the table
-- the live V2 drafting pipeline actually reads (resolveArchitectureVersion
-- is hardcoded to 'v2' for every user as of 15 September) — the
-- Settings UI for it depends on these policies existing to work at all.

CREATE POLICY user_brain_v2_select ON user_brain_v2 FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_brain_v2_insert ON user_brain_v2 FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY user_brain_v2_update ON user_brain_v2 FOR UPDATE USING (user_id = auth.uid());
