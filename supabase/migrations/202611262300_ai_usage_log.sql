-- AI usage tracking (26 Nov 2026). One row per OpenAI call: who, which feature, which model,
-- how many tokens. Cost is NOT stored: it is worked out when viewed from a price table in code,
-- so a corrected price fixes history too. Written only by the server (service role); users read
-- their own totals through /api/ai-usage. Rollback: DROP FUNCTION ai_usage_summary(uuid,int);
-- DROP TABLE ai_usage_log;
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  project_id text,
  feature text NOT NULL,
  endpoint text NOT NULL,
  model_requested text,
  model_returned text,
  prompt_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  cached_tokens integer,
  total_tokens integer,
  finish_reason text,
  latency_ms integer,
  status integer
);
CREATE INDEX IF NOT EXISTS ai_usage_log_user_created_idx ON public.ai_usage_log (user_id, created_at DESC);
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ai_usage_summary(p_user uuid, p_days integer DEFAULT 30)
RETURNS TABLE (day date, feature text, endpoint text, model text, calls bigint,
               prompt_tokens bigint, completion_tokens bigint, reasoning_tokens bigint,
               cached_tokens bigint, truncated bigint, errors bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (created_at AT TIME ZONE 'Europe/London')::date, l.feature, l.endpoint,
         coalesce(l.model_returned, l.model_requested), count(*),
         coalesce(sum(prompt_tokens),0), coalesce(sum(completion_tokens),0),
         coalesce(sum(reasoning_tokens),0), coalesce(sum(cached_tokens),0),
         count(*) FILTER (WHERE finish_reason = 'length'),
         count(*) FILTER (WHERE status >= 400)
  FROM ai_usage_log l
  WHERE l.user_id = p_user AND l.created_at >= now() - make_interval(days => greatest(p_days,1))
  GROUP BY 1,2,3,4
$$;
REVOKE ALL ON FUNCTION public.ai_usage_summary(uuid,integer) FROM PUBLIC, anon, authenticated;
