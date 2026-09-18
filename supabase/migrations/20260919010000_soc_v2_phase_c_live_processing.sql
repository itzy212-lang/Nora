-- SOC v2 Phase C — Live Processing
--
-- Documents schema changes already applied live during this phase's
-- implementation (soc_notes lifecycle columns, process_soc_note_atomic
-- accepting section_id). Written as a record for the migration history,
-- matching the practice established in Phase B.
--
-- Additive only. No existing column, row or behaviour removed.

-- ─── soc_notes — per-note processing lifecycle (Pipeline Spec §6, Inspection
-- State Contract §28) ─────────────────────────────────────────────────────
-- Replaces the previous fire-and-forget "no tracked lifecycle at all"
-- state with an explicit, code-enforced one: saved -> processing ->
-- processed | clarification_required | failed. A failed note is now
-- visible and identifiable (processing_error), never silently
-- indistinguishable from a successfully processed one.

ALTER TABLE soc_notes ADD COLUMN IF NOT EXISTS processing_status text
  CHECK (processing_status IN ('saved','processing','processed','clarification_required','failed'));
ALTER TABLE soc_notes ADD COLUMN IF NOT EXISTS processing_error text;

CREATE INDEX IF NOT EXISTS idx_soc_notes_processing_status ON soc_notes(session_id, processing_status);

-- ─── process_soc_note_atomic — accept and store the resolved section_id
-- (Inspection State Contract §4) ────────────────────────────────────────
-- Adds a tenth parameter, p_section_id, defaulting to NULL so any
-- existing caller that doesn't pass it continues to work unchanged.
-- Populates soc_claims.section_id on insert, completing the link the
-- Phase B migration added the column for but nothing yet populated.
--
-- Full function body recreated here for a complete migration record;
-- logic is otherwise identical to the Phase B version (same idempotent
-- existence-check insert, same disposition mapping, same supersession
-- handling) — see that migration's comments for the reasoning behind
-- those specific choices.

CREATE OR REPLACE FUNCTION process_soc_note_atomic(
  p_session_id uuid,
  p_note_id uuid,
  p_sequence integer,
  p_claims jsonb,
  p_section text,
  p_note_type text,
  p_correction_mode text,
  p_project_id text DEFAULT NULL::text,
  p_ao_id text DEFAULT NULL::text,
  p_section_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_lock_key      bigint;
  v_last_seq      integer;
  v_claims_inserted integer := 0;
  v_superseded    integer := 0;
  v_claim         jsonb;
  v_amended_elements text[];
  v_claim_type    text;
  v_disposition   text;
  v_claim_id      text;
BEGIN
  v_lock_key := hashtext(p_session_id::text);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT COALESCE(MAX(note_sequence), 0)
  INTO v_last_seq
  FROM public.soc_claims
  WHERE session_id = p_session_id;

  IF p_sequence < v_last_seq THEN
    RAISE EXCEPTION 'SEQUENCE_ERROR: received note % but last persisted sequence is %. Concurrent conflict or replay.', p_sequence, v_last_seq;
  END IF;

  FOR v_claim IN SELECT * FROM jsonb_array_elements(p_claims)
  LOOP
    v_claim_id := v_claim->>'claim_id';
    v_claim_type := COALESCE(v_claim->>'claim_type', 'unresolved');

    v_disposition := CASE
      WHEN v_claim_type IN ('section_declaration', 'contextual') THEN 'navigation_context'
      WHEN v_claim_type IN ('award_note', 'site_note') THEN 'site_general_note'
      WHEN v_claim_type = 'unresolved' THEN 'unresolved'
      WHEN v_claim_type = 'excluded' THEN 'duplicate'
      WHEN COALESCE(v_claim->>'status', 'active') = 'superseded' THEN 'superseded'
      ELSE 'active_evidence'
    END;

    IF NOT EXISTS (
      SELECT 1 FROM public.soc_claims
      WHERE session_id = p_session_id AND claim_id = v_claim_id
    ) THEN
      INSERT INTO public.soc_claims (
        session_id, project_id, ao_id,
        claim_id,
        source_note_id,  note_sequence,
        sequence,        claim_sequence,
        claim_type, section, element, location, content,
        confidence, status, amendment_mode, superseded_by,
        construction, finish, condition, defect_type, direction,
        measurement, extent, operational_result, access_limitation,
        raw_fragment, disposition, section_id
      ) VALUES (
        p_session_id, p_project_id, p_ao_id,
        v_claim_id,
        p_sequence, p_sequence,
        COALESCE((v_claim->>'sequence')::integer, 1),
        COALESCE((v_claim->>'sequence')::integer, 1),
        v_claim_type,
        v_claim->>'section',
        v_claim->>'element',
        v_claim->>'location',
        COALESCE(v_claim->>'content', ''),
        COALESCE(v_claim->>'confidence', 'high'),
        COALESCE(v_claim->>'status', 'active'),
        v_claim->>'amendment_mode',
        v_claim->>'superseded_by',
        v_claim->>'construction',
        v_claim->>'finish',
        v_claim->>'condition',
        v_claim->>'defect_type',
        v_claim->>'direction',
        v_claim->>'measurement',
        v_claim->>'extent',
        v_claim->>'operational_result',
        v_claim->>'access_limitation',
        v_claim->>'raw_fragment',
        v_disposition,
        p_section_id
      );
      v_claims_inserted := v_claims_inserted + 1;
    END IF;
  END LOOP;

  IF p_correction_mode IN ('replace', 'correct_measurement', 'correct_location', 'correct_direction', 'withdraw') THEN
    SELECT ARRAY_AGG(DISTINCT elem->>'element')
    INTO v_amended_elements
    FROM jsonb_array_elements(p_claims) AS elem
    WHERE elem->>'amendment_mode' IS NOT NULL
      AND elem->>'element' IS NOT NULL;

    IF v_amended_elements IS NOT NULL AND array_length(v_amended_elements, 1) > 0 THEN
      UPDATE public.soc_claims
      SET status      = 'superseded',
          disposition = 'superseded',
          updated_at  = now()
      WHERE session_id    = p_session_id
        AND note_sequence < p_sequence
        AND status        = 'active'
        AND section       = p_section
        AND element       = ANY(v_amended_elements);

      GET DIAGNOSTICS v_superseded = ROW_COUNT;
    END IF;
  END IF;

  IF p_note_id IS NOT NULL THEN
    UPDATE public.soc_notes
    SET note_status = CASE
          WHEN p_note_type = 'amendment' THEN 'amended'
          WHEN p_note_type = 'contextual' THEN 'contextual'
          WHEN p_note_type = 'site_note'  THEN 'site_note'
          WHEN p_note_type = 'unresolved' THEN 'unresolved'
          ELSE 'allocated'
        END,
        current_section = p_section
    WHERE id = p_note_id AND session_id = p_session_id;
  END IF;

  RETURN jsonb_build_object(
    'ok',               true,
    'session_id',       p_session_id,
    'note_sequence',    p_sequence,
    'claims_inserted',  v_claims_inserted,
    'claims_superseded', v_superseded,
    'lock_key',         v_lock_key
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;
