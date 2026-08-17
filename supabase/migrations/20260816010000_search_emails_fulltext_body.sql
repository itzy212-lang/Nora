-- Repository record of an already-applied migration (2026-08-16).
-- Real, reported bug: search timing out intermittently — confirmed
-- directly for a real search term ('Dan'): 5.5 seconds, hitting the
-- statement timeout in the live app. Traced to the body column
-- specifically: a trigram GIN index is 'lossy' for ILIKE — it finds
-- candidates fast, but Postgres must then re-fetch and re-verify the
-- full body text (averaging 35KB+) for every candidate row before
-- trusting the match. For a short, common term, that meant
-- re-verifying ~1,800 large rows via expensive heap I/O — confirmed
-- via EXPLAIN ANALYZE that trimming the selected columns did NOT
-- help (the cost is in the heap fetch to verify, not what's
-- returned).
--
-- Real fix: proper PostgreSQL full-text search for the body column
-- specifically (not lossy in the same way) — a generated tsvector
-- column with its own GIN index, and prefix-matching AND queries
-- built from the raw search term (e.g. 'John Smith' becomes
-- john:* & smith:*). Confirmed via EXPLAIN ANALYZE: the same 'Dan'
-- search now takes ~86ms, not 5,500ms. Other columns (subject,
-- sender, recipients) remain trigram-indexed ILIKE UNION branches,
-- which were already fast — this leaves those untouched.
ALTER TABLE emails ADD COLUMN IF NOT EXISTS body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_emails_body_tsv ON emails USING gin(body_tsv);

CREATE OR REPLACE FUNCTION public.search_emails(search_term text, result_limit int DEFAULT 300)
RETURNS SETOF emails
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tsq tsquery;
BEGIN
  BEGIN
    tsq := to_tsquery('simple', string_agg(word || ':*', ' & '))
      FROM (
        SELECT regexp_replace(w, '[^a-zA-Z0-9]', '', 'g') AS word
        FROM unnest(regexp_split_to_array(trim(search_term), '\s+')) AS w
        WHERE length(regexp_replace(w, '[^a-zA-Z0-9]', '', 'g')) > 0
      ) words;
  EXCEPTION WHEN OTHERS THEN
    tsq := NULL;
  END;

  RETURN QUERY
  SELECT * FROM (
    SELECT * FROM emails WHERE subject ILIKE '%' || search_term || '%'
    UNION
    (SELECT * FROM emails WHERE tsq IS NOT NULL AND body_tsv @@ tsq ORDER BY received_at DESC LIMIT result_limit)
    UNION
    SELECT * FROM emails WHERE sender_name ILIKE '%' || search_term || '%'
    UNION
    SELECT * FROM emails WHERE sender_email ILIKE '%' || search_term || '%'
    UNION
    SELECT * FROM emails WHERE to_email ILIKE '%' || search_term || '%'
    UNION
    SELECT * FROM emails WHERE cc_emails ILIKE '%' || search_term || '%'
    UNION
    SELECT * FROM emails WHERE to_emails::text ILIKE '%' || search_term || '%'
    UNION
    SELECT * FROM emails WHERE raw_recipients::text ILIKE '%' || search_term || '%'
  ) combined
  ORDER BY received_at DESC
  LIMIT result_limit;
END;
$$;
