-- Security/operational correction (2026-08-07). Repository record of an
-- already-applied migration — operational logging and concurrency
-- protection for the email-embeddings backfill job. Never contains email
-- bodies, embeddings, or secrets. The cron secret itself is stored in
-- Supabase Vault (secret name 'embedding_backfill_cron_secret'), NOT in
-- this file or any other repository file.

CREATE TABLE IF NOT EXISTS public.embedding_backfill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  rows_selected integer,
  rows_embedded integer,
  rows_failed integer,
  error_summary text,
  duration_ms integer,
  skipped_due_to_concurrent_run boolean NOT NULL DEFAULT false,
  project_id text
);

COMMENT ON TABLE public.embedding_backfill_runs IS 'Operational log for the email-embeddings backfill job. Never contains email bodies, embeddings, or secrets.';

-- Concurrency protection: at most one in-progress run (completed_at IS
-- NULL) at a time. A second concurrent insert attempt violates this
-- partial unique index and is caught by the endpoint as "another run is
-- active, skip" — atomic, safe under serverless concurrency without a
-- session-held advisory lock.
CREATE UNIQUE INDEX IF NOT EXISTS embedding_backfill_runs_one_active
  ON public.embedding_backfill_runs ((completed_at IS NULL))
  WHERE completed_at IS NULL;

ALTER TABLE public.embedding_backfill_runs ENABLE ROW LEVEL SECURITY;
-- Deliberately no anon/authenticated policies — service-role only, same
-- pattern as user_brain_v2 and every other server-only table in this
-- project.
