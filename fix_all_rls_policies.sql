-- Fix all read-only RLS policies by adding write permissions

DROP POLICY IF EXISTS "users_own_ao" ON ao;
CREATE POLICY "users_own_ao" ON ao FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_calendar_events" ON calendar_events;
CREATE POLICY "users_own_calendar_events" ON calendar_events FOR ALL USING (
  (project_id IN (SELECT projects.id FROM projects WHERE (projects.user_id = auth.uid()) OR ((projects.user_id)::text = (auth.jwt() ->> 'email'::text))))
  OR (created_by = (auth.uid())::text) 
  OR (created_by = (auth.jwt() ->> 'email'::text))
) WITH CHECK (
  (project_id IN (SELECT projects.id FROM projects WHERE (projects.user_id = auth.uid()) OR ((projects.user_id)::text = (auth.jwt() ->> 'email'::text))))
  OR (created_by = (auth.uid())::text) 
  OR (created_by = (auth.jwt() ->> 'email'::text))
);

DROP POLICY IF EXISTS "users_own_clause_library" ON clause_library;
CREATE POLICY "users_own_clause_library" ON clause_library FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon read active templates" ON document_templates;
CREATE POLICY "Allow anon read active templates" ON document_templates FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Allow authenticated delete" ON document_templates;
CREATE POLICY "Allow authenticated delete" ON document_templates FOR DELETE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated read" ON document_templates;
CREATE POLICY "Allow authenticated read" ON document_templates FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated update" ON document_templates;
CREATE POLICY "Allow authenticated update" ON document_templates FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "users_own_documents" ON documents;
CREATE POLICY "users_own_documents" ON documents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_email_accounts" ON email_accounts;
CREATE POLICY "users_own_email_accounts" ON email_accounts FOR ALL USING (
  (user_id = (auth.uid())::text) OR (user_id = (auth.jwt() ->> 'email'::text))
) WITH CHECK (
  (user_id = (auth.uid())::text) OR (user_id = (auth.jwt() ->> 'email'::text))
);

DROP POLICY IF EXISTS "users can read their own attachments" ON email_attachments;
CREATE POLICY "users can read their own attachments" ON email_attachments FOR SELECT USING (
  email_external_id IN (SELECT emails.external_id FROM emails WHERE 
    (emails.user_id = (auth.uid())::text) OR (emails.user_id = (auth.jwt() ->> 'email'::text))
  )
);

DROP POLICY IF EXISTS "Allow anon select" ON email_auto_drafts;
CREATE POLICY "Allow anon select" ON email_auto_drafts FOR SELECT USING (true);

DROP POLICY IF EXISTS "users_own_emails" ON emails;
CREATE POLICY "users_own_emails" ON emails FOR ALL USING (
  (user_id = (auth.uid())::text) OR (user_id = (auth.jwt() ->> 'email'::text))
) WITH CHECK (
  (user_id = (auth.uid())::text) OR (user_id = (auth.jwt() ->> 'email'::text))
);

DROP POLICY IF EXISTS "firm_settings_select_own" ON firm_settings;
CREATE POLICY "firm_settings_select_own" ON firm_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "invoices_delete" ON invoices;
CREATE POLICY "invoices_delete" ON invoices FOR DELETE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select" ON invoices FOR SELECT USING (true);

DROP POLICY IF EXISTS "invoices_select_anon" ON invoices;
CREATE POLICY "invoices_select_anon" ON invoices FOR SELECT USING (true);

DROP POLICY IF EXISTS "invoices_update" ON invoices;
CREATE POLICY "invoices_update" ON invoices FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "users_own_leads" ON leads;
CREATE POLICY "users_own_leads" ON leads FOR ALL USING (
  (user_id = (auth.uid())::text) OR (user_id = (auth.jwt() ->> 'email'::text)) OR (user_id IS NULL)
) WITH CHECK (
  (user_id = (auth.uid())::text) OR (user_id = (auth.jwt() ->> 'email'::text)) OR (user_id IS NULL)
);

DROP POLICY IF EXISTS "users_own_notices" ON notices;
CREATE POLICY "users_own_notices" ON notices FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_read_own_project_notices" ON notices;
CREATE POLICY "users_read_own_project_notices" ON notices FOR SELECT USING (
  (user_id = auth.uid()) OR (EXISTS (SELECT 1 FROM projects p WHERE (p.id = notices.project_id) AND ((p.user_id = auth.uid()) OR ((p.user_id)::text = (auth.jwt() ->> 'email'::text)))))
);

DROP POLICY IF EXISTS "users_own_projects" ON projects;
CREATE POLICY "users_own_projects" ON projects FOR ALL USING (
  (user_id = auth.uid()) OR ((user_id)::text = (auth.jwt() ->> 'email'::text))
) WITH CHECK (
  (user_id = auth.uid()) OR ((user_id)::text = (auth.jwt() ->> 'email'::text))
);

DROP POLICY IF EXISTS "Service role full access" ON push_subscriptions;
CREATE POLICY "Service role full access" ON push_subscriptions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can manage own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users can manage own push subscriptions" ON push_subscriptions FOR ALL USING (
  (user_id = (auth.uid())::text) OR (user_id = auth.email())
) WITH CHECK (
  (user_id = (auth.uid())::text) OR (user_id = auth.email())
);

DROP POLICY IF EXISTS "pwai_orders_anon_select_by_ref" ON pwai_orders;
CREATE POLICY "pwai_orders_anon_select_by_ref" ON pwai_orders FOR SELECT USING (true);

DROP POLICY IF EXISTS "service read referrals" ON pwai_surveyor_referrals;
CREATE POLICY "service read referrals" ON pwai_surveyor_referrals FOR SELECT USING (true);

DROP POLICY IF EXISTS "users_own_tasks" ON tasks;
CREATE POLICY "users_own_tasks" ON tasks FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
