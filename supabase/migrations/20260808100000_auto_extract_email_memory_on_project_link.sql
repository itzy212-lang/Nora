-- Repository record of an already-applied migration (2026-08-08).
-- Automatic email-memory extraction trigger — fires whenever an
-- email's project_id is set (INSERT with project_id present, or UPDATE
-- from NULL to a real value), catching every linking path (thread
-- auto-linking, manual linking via any UI surface) in one place rather
-- than depending on the caller remembering to trigger extraction.
-- Fire-and-forget via net.http_post, same pattern as the embedding
-- backfill and sync_outlook crons already running on this project.
CREATE OR REPLACE FUNCTION public.trigger_extract_email_memory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.project_id IS NULL) AND NEW.body IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://nora-d9wy.vercel.app/api/extract-email-memory',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'extract_email_memory_trigger_secret')
      ),
      body := jsonb_build_object(
        'project_id', NEW.project_id,
        'email_id', NEW.id,
        'subject', NEW.subject,
        'body', NEW.body,
        'direction', CASE WHEN NEW.folder = 'Sent' THEN 'sent' ELSE 'received' END,
        'from_address', NEW.sender_email,
        'to_address', NEW.to_emails,
        'received_at', COALESCE(NEW.received_at, NEW.sent_at)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS extract_email_memory_on_project_link ON public.emails;
CREATE TRIGGER extract_email_memory_on_project_link
  AFTER INSERT OR UPDATE OF project_id ON public.emails
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_extract_email_memory();

COMMENT ON FUNCTION public.trigger_extract_email_memory IS 'Automatically extracts durable facts into project_memory whenever an email becomes linked to a project — added 2026-08-08, catches all linking paths in one place.';
