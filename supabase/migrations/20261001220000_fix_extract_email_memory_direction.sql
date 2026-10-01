-- Fixed 2026-10-01: trigger_extract_email_memory() (2026-08-08) derived
-- the 'direction' it sends to /api/extract-email-memory purely from
-- NEW.folder = 'Sent' — but folder is only ever set to 'Sent' by the
-- manual "send from Inbox" path in useEmails.js. Both cron-auto-draft.js
-- insert paths for an AI-sent auto-response set direction='outgoing'
-- and is_sent=true correctly, but never set folder at all, so this
-- trigger classified every one of those as 'received' instead.
--
-- Confirmed live on project proj_1789677862885_hpneuib: Nora's own wrong
-- auto-sent reply ("Yes — Itzik has been appointed to act on behalf of
-- the adjoining owners at 24 Allendale Road") was extracted into
-- project_memory as source_type 'email_received' — i.e. filed as if a
-- correspondent had told Nora this, not as something Nora herself wrote
-- and got wrong. That mislabeled "fact" then sits in project_memory
-- indistinguishable from a real external confirmation, available to be
-- surfaced by semantic search on every future email on that project —
-- a feedback loop that reinforces the AI's own mistake as if it were
-- independently-confirmed project history.
--
-- Now prefers the columns the app actually keeps in sync for this
-- (direction / is_sent), falling back to folder only when neither is
-- set, rather than the other way around.
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
        'direction', CASE
          WHEN NEW.direction = 'outgoing' OR NEW.is_sent = true THEN 'sent'
          WHEN NEW.direction = 'incoming' THEN 'received'
          WHEN NEW.folder = 'Sent' THEN 'sent'
          ELSE 'received'
        END,
        'from_address', NEW.sender_email,
        'to_address', NEW.to_emails,
        'received_at', COALESCE(NEW.received_at, NEW.sent_at)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_extract_email_memory IS 'Automatically extracts durable facts into project_memory whenever an email becomes linked to a project. Fixed 2026-10-01: direction now read from direction/is_sent (what the app actually sets) before falling back to folder, so an AI auto-sent reply is never filed into project_memory as if a correspondent had said it.';
