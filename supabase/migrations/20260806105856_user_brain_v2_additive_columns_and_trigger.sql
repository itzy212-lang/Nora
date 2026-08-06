-- Repository record of an already-applied Supabase migration.
-- Live version: 20260806105856 "user_brain_v2_additive_columns_and_trigger".
-- Exact reproduction of the SQL actually applied. Additive only — does not
-- drop, rename, or overwrite any existing column or row. Idempotent:
-- ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER.
--
-- Does NOT include the row-level UPDATE that populated sign_off and
-- banned_phrases_structured for the existing Itzik row that already
-- existed at the time this migration ran — that was user-specific data,
-- not schema, and per the private-data decision (see
-- docs/nora-v2/PRIVATE_SEED_PROVISIONING.md) user-specific content is
-- provisioned separately, never committed to this public repository.

ALTER TABLE public.user_brain_v2
  ADD COLUMN IF NOT EXISTS sign_off text,
  ADD COLUMN IF NOT EXISTS banned_phrases_structured jsonb;

CREATE OR REPLACE FUNCTION public.trigger_user_brain_v2_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$;

DROP TRIGGER IF EXISTS set_user_brain_v2_updated_at ON public.user_brain_v2;
CREATE TRIGGER set_user_brain_v2_updated_at
  BEFORE UPDATE ON public.user_brain_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_user_brain_v2_updated_at();

COMMENT ON COLUMN public.user_brain_v2.banned_phrases_structured IS 'Structured form of banned_phrases (text), added additively. banned_phrases retained unchanged as the original source; this column is grouped for programmatic use.';
COMMENT ON COLUMN public.user_brain_v2.sign_off IS 'Added additively. Populated per-user by the provisioning process, not by this schema migration.';
