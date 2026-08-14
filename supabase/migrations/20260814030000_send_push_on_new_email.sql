-- Repository record of an already-applied migration (2026-08-14).
-- Real, background-capable push notification on every new incoming
-- email, replacing the old local-only notification that required the
-- app to already be open (found while investigating a reported gap:
-- notifications for new mail only ever appeared after opening the app).
CREATE OR REPLACE FUNCTION public.trigger_send_email_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.direction = 'incoming' OR (NEW.direction IS NULL AND NEW.is_sent IS NOT TRUE)) THEN
    PERFORM net.http_post(
      url := 'https://nora-d9wy.vercel.app/api/send-email-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'send_email_push_trigger_secret')
      ),
      body := jsonb_build_object('email_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS send_push_on_new_email ON public.emails;
CREATE TRIGGER send_push_on_new_email
  AFTER INSERT ON public.emails
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_send_email_push();

COMMENT ON FUNCTION public.trigger_send_email_push IS 'Sends a real, background-capable push notification for every new incoming email — added 2026-08-14, replaces the old local-only notification that required the app to already be open.';
