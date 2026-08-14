-- Repository record of an already-applied migration (2026-08-14).
-- Real, comprehensive email search as a Postgres function, called via
-- RPC — replaces a PostgREST .or() filter-string attempt that failed
-- for JSONB recipient fields (to_emails, raw_recipients), silently
-- breaking every search including guaranteed matches. Tested directly
-- against live data before being wired into the frontend: confirmed
-- it correctly finds matches in subject/body/sender, and in
-- recipients buried inside the JSONB fields.
CREATE OR REPLACE FUNCTION public.search_emails(search_term text, result_limit int DEFAULT 300)
RETURNS SETOF emails
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM emails
  WHERE
    subject ILIKE '%' || search_term || '%'
    OR body ILIKE '%' || search_term || '%'
    OR sender_name ILIKE '%' || search_term || '%'
    OR sender_email ILIKE '%' || search_term || '%'
    OR to_email ILIKE '%' || search_term || '%'
    OR cc_emails ILIKE '%' || search_term || '%'
    OR to_emails::text ILIKE '%' || search_term || '%'
    OR raw_recipients::text ILIKE '%' || search_term || '%'
  ORDER BY received_at DESC
  LIMIT result_limit;
$$;

COMMENT ON FUNCTION public.search_emails IS 'Real, comprehensive email search — sender, recipients (to/cc, including JSONB fields), subject, body. Added 2026-08-14 after the PostgREST .or() filter-string approach failed for JSONB columns.';
