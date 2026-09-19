-- SOC v2 Phase C — Targeted correction/supersession
--
-- Documents a schema-free redesign of correction targeting, applied
-- live during this phase's implementation. No new column was needed -
-- claim_id (already unique per claim) and superseded_by (an existing,
-- previously-unused column) were sufficient. The model now states
-- corrects_claim_id explicitly on an amendment claim - the exact prior
-- claim_id (from RECENT CONTEXT, which already labels every claim it
-- shows the model) that correction targets - and this RPC acts on
-- that reference alone. No heuristic matching (same element, latest
-- claim, keyword matching) is used anywhere in this path, per explicit
-- instruction.
--
-- Replaces the previous broad, element-matched supersession (Phase C,
-- 2026-09-19 first round), which superseded every active claim sharing
-- the corrected element - so correcting one crack's measurement also
-- silently superseded the same wall's unrelated finish and condition
-- claims. Also fixes attribute loss: the new active claim is now the
-- targeted claim's complete attribute set with only the model-supplied
-- fields overridden, not a bare fragment carrying just the changed
-- value.
--
-- Verified directly against the live database (a throwaway, isolated
-- test session, cleaned up afterward): correcting one crack's
-- measurement supersedes only that crack, preserving unrelated
-- finish/condition claims and a second, different crack on the same
-- wall untouched; the resulting active claim carries the target's
-- full attributes (defect type, direction, location) plus the new
-- measurement; a chained second correction correctly supersedes the
-- first correction, not the original; a correction naming a claim_id
-- that doesn't exist falls back safely to an unmerged, standalone
-- claim rather than guessing a target or erroring.

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
  v_claim_type    text;
  v_disposition   text;
  v_claim_id      text;
  v_corrects_id   text;
  v_target        soc_claims%ROWTYPE;
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
    v_corrects_id := v_claim->>'corrects_claim_id';

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

      IF v_claim->>'amendment_mode' IS NOT NULL AND v_corrects_id IS NOT NULL THEN

        SELECT * INTO v_target
        FROM public.soc_claims
        WHERE session_id = p_session_id AND claim_id = v_corrects_id AND status = 'active'
        FOR UPDATE;

        IF FOUND THEN
          UPDATE public.soc_claims
          SET status = 'superseded', disposition = 'superseded',
              superseded_by = v_claim_id, updated_at = now()
          WHERE session_id = p_session_id AND claim_id = v_corrects_id;
          v_superseded := v_superseded + 1;

          INSERT INTO public.soc_claims (
            session_id, project_id, ao_id, claim_id, source_note_id,
            note_sequence, sequence, claim_sequence, claim_type, section,
            element, location, content, confidence, status,
            amendment_mode, superseded_by,
            construction, finish, condition, defect_type, direction,
            measurement, extent, operational_result, access_limitation,
            raw_fragment, disposition, section_id
          ) VALUES (
            p_session_id, p_project_id, p_ao_id, v_claim_id,
            p_sequence, p_sequence,
            COALESCE((v_claim->>'sequence')::integer, 1),
            COALESCE((v_claim->>'sequence')::integer, 1),
            v_claim_type, v_claim->>'section',
            COALESCE(v_claim->>'element', v_target.element),
            COALESCE(v_claim->>'location', v_target.location),
            COALESCE(v_claim->>'content', v_target.content, ''),
            COALESCE(v_claim->>'confidence', 'high'),
            'active',
            v_claim->>'amendment_mode',
            NULL,
            COALESCE(v_claim->>'construction', v_target.construction),
            COALESCE(v_claim->>'finish', v_target.finish),
            COALESCE(v_claim->>'condition', v_target.condition),
            COALESCE(v_claim->>'defect_type', v_target.defect_type),
            COALESCE(v_claim->>'direction', v_target.direction),
            COALESCE(v_claim->>'measurement', v_target.measurement),
            COALESCE(v_claim->>'extent', v_target.extent),
            COALESCE(v_claim->>'operational_result', v_target.operational_result),
            COALESCE(v_claim->>'access_limitation', v_target.access_limitation),
            v_claim->>'raw_fragment',
            'active_evidence',
            p_section_id
          );
          v_claims_inserted := v_claims_inserted + 1;

        ELSE
          INSERT INTO public.soc_claims (
            session_id, project_id, ao_id, claim_id, source_note_id,
            note_sequence, sequence, claim_sequence, claim_type, section,
            element, location, content, confidence, status,
            amendment_mode, superseded_by,
            construction, finish, condition, defect_type, direction,
            measurement, extent, operational_result, access_limitation,
            raw_fragment, disposition, section_id
          ) VALUES (
            p_session_id, p_project_id, p_ao_id, v_claim_id,
            p_sequence, p_sequence,
            COALESCE((v_claim->>'sequence')::integer, 1),
            COALESCE((v_claim->>'sequence')::integer, 1),
            v_claim_type, v_claim->>'section',
            v_claim->>'element', v_claim->>'location',
            COALESCE(v_claim->>'content', ''),
            COALESCE(v_claim->>'confidence', 'high'),
            'active',
            v_claim->>'amendment_mode', NULL,
            v_claim->>'construction', v_claim->>'finish', v_claim->>'condition',
            v_claim->>'defect_type', v_claim->>'direction', v_claim->>'measurement',
            v_claim->>'extent', v_claim->>'operational_result', v_claim->>'access_limitation',
            v_claim->>'raw_fragment', v_disposition, p_section_id
          );
          v_claims_inserted := v_claims_inserted + 1;
        END IF;

      ELSE
        INSERT INTO public.soc_claims (
          session_id, project_id, ao_id, claim_id, source_note_id,
          note_sequence, sequence, claim_sequence, claim_type, section,
          element, location, content, confidence, status,
          amendment_mode, superseded_by,
          construction, finish, condition, defect_type, direction,
          measurement, extent, operational_result, access_limitation,
          raw_fragment, disposition, section_id
        ) VALUES (
          p_session_id, p_project_id, p_ao_id, v_claim_id,
          p_sequence, p_sequence,
          COALESCE((v_claim->>'sequence')::integer, 1),
          COALESCE((v_claim->>'sequence')::integer, 1),
          v_claim_type, v_claim->>'section',
          v_claim->>'element', v_claim->>'location',
          COALESCE(v_claim->>'content', ''),
          COALESCE(v_claim->>'confidence', 'high'),
          COALESCE(v_claim->>'status', 'active'),
          v_claim->>'amendment_mode', v_claim->>'superseded_by',
          v_claim->>'construction', v_claim->>'finish', v_claim->>'condition',
          v_claim->>'defect_type', v_claim->>'direction', v_claim->>'measurement',
          v_claim->>'extent', v_claim->>'operational_result', v_claim->>'access_limitation',
          v_claim->>'raw_fragment', v_disposition, p_section_id
        );
        v_claims_inserted := v_claims_inserted + 1;
      END IF;

    END IF;
  END LOOP;

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
