-- Repository record of an already-applied migration (2026-08-07).
-- Secure, transactional, ownership-validated batch deletion of Project
-- Chat sessions. Callable only with the service role, from
-- api/delete-project-chat-sessions.js, after that endpoint has
-- independently verified the caller's identity via a real bearer
-- token — never exposed directly to the browser.
--
-- Honest limitation: stage1_briefs has no session_id column (confirmed
-- directly before this was written), so diagnostics rows are matched by
-- project_id + user_id + a time window around the session's
-- [created_at, updated_at] range, widened by 2 minutes each side — the
-- same best-effort approach already used manually throughout this
-- project's testing, now made consistent rather than ad hoc.
--
-- A real type mismatch (ai_sessions.user_id/project_id are text, not
-- uuid) and a real "double-reports deleted sessions as also not found"
-- bug were both found by testing this function live before it shipped,
-- not caught by review alone — both are already fixed in the version
-- below.

CREATE OR REPLACE FUNCTION public.delete_project_chat_sessions(
  p_user_id text,
  p_session_ids uuid[]
)
RETURNS TABLE (
  session_id uuid,
  deleted boolean,
  reason text,
  messages_deleted integer,
  diagnostics_deleted integer,
  working_context_deleted integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_msg_count integer;
  v_diag_count integer;
  v_ctx_count integer;
  v_matched_ids uuid[];
BEGIN
  SELECT array_agg(s0.id) INTO v_matched_ids
  FROM ai_sessions s0 WHERE s0.id = ANY(p_session_ids);

  FOR v_session IN
    SELECT s.id, s.user_id, s.surface, s.project_id, s.created_at, s.updated_at
    FROM ai_sessions s
    WHERE s.id = ANY(p_session_ids)
  LOOP
    IF v_session.user_id IS DISTINCT FROM p_user_id THEN
      RETURN QUERY SELECT v_session.id, false, 'not_owned_by_user'::text, 0, 0, 0;
      CONTINUE;
    END IF;

    IF v_session.surface IS DISTINCT FROM 'project_chat' THEN
      RETURN QUERY SELECT v_session.id, false, 'not_a_project_chat_session'::text, 0, 0, 0;
      CONTINUE;
    END IF;

    DELETE FROM ai_messages WHERE ai_messages.session_id = v_session.id;
    GET DIAGNOSTICS v_msg_count = ROW_COUNT;

    DELETE FROM ai_working_context WHERE ai_working_context.session_id = v_session.id;
    GET DIAGNOSTICS v_ctx_count = ROW_COUNT;

    DELETE FROM stage1_briefs
      WHERE stage1_briefs.project_id = v_session.project_id
        AND stage1_briefs.user_id = p_user_id
        AND stage1_briefs.brief->>'schema_version' = 'nora_v2_diagnostics_v1'
        AND stage1_briefs.created_at BETWEEN (v_session.created_at - interval '2 minutes')
                                          AND (v_session.updated_at + interval '2 minutes');
    GET DIAGNOSTICS v_diag_count = ROW_COUNT;

    DELETE FROM ai_sessions WHERE ai_sessions.id = v_session.id;

    RETURN QUERY SELECT v_session.id, true, NULL::text, v_msg_count, v_diag_count, v_ctx_count;
  END LOOP;

  RETURN QUERY
    SELECT req_id, false, 'session_not_found'::text, 0, 0, 0
    FROM unnest(p_session_ids) AS req_id
    WHERE NOT (req_id = ANY(COALESCE(v_matched_ids, ARRAY[]::uuid[])));
END;
$$;

COMMENT ON FUNCTION public.delete_project_chat_sessions(text, uuid[]) IS 'Secure, ownership-validated, transactional batch delete for Project Chat sessions. Called only from api/delete-project-chat-sessions.js after independent bearer-token verification — never called directly from the browser.';
