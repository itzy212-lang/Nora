-- SOC v2 Phase B — Foundations
-- Approved architecture per Nora SOC v2 specifications (Universal SOC Brain
-- v2, User SOC Brain v2, Inspection State Contract v1, Pipeline &
-- Reconciliation Spec v1, Fidelity Audit Spec v1, Professional Quality
-- Audit Spec v1) and the Claude Implementation Master Instructions.
--
-- This migration is purely additive. It does not remove or repurpose any
-- column, table or RPC parameter the current live SOC path depends on.
-- The one deliberate behaviour change is documented at the RPC change
-- below: previously-discarded structured claim fields are now persisted.

-- ─── 1. soc_sections — stable section identity (Inspection State Contract §4-7) ──
-- The genuine structural gap identified in the pre-implementation report:
-- today a "room" is only ever matched by string equality on its display
-- name, which is why a returned-to room can be duplicated in output. This
-- table gives every genuine room/area a stable identity and records the
-- order sections were first entered, independent of drafting-model
-- compliance with any ordering instruction.

CREATE TABLE IF NOT EXISTS soc_sections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id             uuid NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  project_id             text,
  ao_id                  text,
  -- Stable matching key, independent of small display-text variation
  -- (case/whitespace) — the surveyor's own room name, normalised.
  section_key            text NOT NULL,
  display_name           text NOT NULL,
  floor_level            text,
  first_entered_sequence integer NOT NULL,
  last_active_sequence   integer,
  -- Inspection Contract §7 — describes inspection circumstance, never
  -- condition. not_accessed must never be read as "no defects".
  status                 text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','inspected','partly_inspected',
                                              'photographed_only','not_accessed',
                                              'inspection_restricted')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_soc_sections_session ON soc_sections(session_id);
CREATE INDEX IF NOT EXISTS idx_soc_sections_first_entered ON soc_sections(session_id, first_entered_sequence);

ALTER TABLE soc_sections ENABLE ROW LEVEL SECURITY;
-- Matches the existing, established pattern for soc_claims/soc_notes/
-- soc_observations: backend-only table, accessed exclusively via the
-- service-role key, which bypasses RLS entirely by design. No policies
-- needed for correct operation — same precedent as its sibling SOC tables.

-- ─── 2. soc_claims — expand to capture the structured fields already being
-- computed live and, until now, silently discarded (pre-implementation
-- report, Part 2 of the targeted investigation). Every one of these
-- fields is already present in the JSON the claim-extraction model
-- returns on every note — process-soc-note.js already sends the complete
-- object as p_claims. Only the RPC needs to change to stop dropping them.

ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS construction         text;
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS finish               text;
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS condition            text;
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS defect_type          text;
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS direction            text;
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS measurement          text;
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS extent               text;
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS operational_result   text;
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS access_limitation    text;
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS raw_fragment         text;

-- Stable section reference (Inspection State Contract §4). Nullable and
-- additive — existing rows and the existing text-based `section` column
-- are untouched; this is populated going forward once section resolution
-- is wired to create/reuse soc_sections rows (Phase C), not by this
-- migration itself.
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES soc_sections(id);
CREATE INDEX IF NOT EXISTS idx_soc_claims_section_id ON soc_claims(section_id);

-- Evidence disposition (Inspection State Contract §18), implemented
-- cleanly per instruction rather than repurposing the existing
-- destination_type/destination_id/represented columns, whose actual
-- semantics ('soc_row' / 'excluded' output-linkage) don't match the
-- Contract's six evidence categories. Those three columns are left in
-- place unmodified — they answer a genuinely different, still-useful
-- question ("which output row did this become") — but are no longer
-- the disposition mechanism.
ALTER TABLE soc_claims ADD COLUMN IF NOT EXISTS disposition text
  CHECK (disposition IN ('active_evidence','superseded','duplicate',
                          'navigation_context','site_general_note','unresolved'));
CREATE INDEX IF NOT EXISTS idx_soc_claims_disposition ON soc_claims(disposition);

COMMENT ON COLUMN soc_claims.destination_type IS
  'Output-row linkage (which drafted row this claim became, or "excluded" if manually removed during review) — NOT the Inspection State Contract disposition. See soc_claims.disposition for that.';
COMMENT ON COLUMN soc_claims.disposition IS
  'Inspection State Contract §18 evidence disposition: active_evidence | superseded | duplicate | navigation_context | site_general_note | unresolved. Populated by process_soc_note_atomic.';

-- ─── 3. soc_notes — observability for the live structured response
-- (Inspection State Contract §21, Master Instructions §39). Additive
-- only. The existing ai_response text column is untouched; this
-- captures the full structured shape once the live processor is
-- restructured to return it (Phase C) — nullable and unused until then.
ALTER TABLE soc_notes ADD COLUMN IF NOT EXISTS structured_response jsonb;

-- ─── 4. soc_reports — prompt/component version provenance
-- (Master Instructions §38, Pipeline Spec §29). Additive, nullable.
-- Not yet populated by the current live generation path in Phase B —
-- the live path does not yet use the v2 components. Will begin being
-- populated once the v2 drafting path is wired in (Phase F).
ALTER TABLE soc_reports ADD COLUMN IF NOT EXISTS brain_versions jsonb;
COMMENT ON COLUMN soc_reports.brain_versions IS
  'Logical versions of the SOC v2 components used to produce this report (universal_soc_brain, user_soc_brain, inspection_state_contract, reconciliation_contract, drafting_contract, fidelity_audit, quality_audit). Null for reports produced by the pre-v2 pipeline.';

-- ─── 5. user_brain_v2 — User SOC Brain style-preference field
-- (Master Instructions §8, User SOC Brain v2 spec). Distinct from the
-- existing soc_gold_standard (an example document, teaches style by
-- demonstration) and distinct from the email-drafting fields
-- (identity_content/voice_content/banned_phrases/sign_off), which are
-- confirmed not read by any SOC code path. This new field holds
-- explicit, stated style preferences for SOC drafting specifically —
-- preferred terminology, sentence construction, level of detail —
-- separate from an example document.
ALTER TABLE user_brain_v2 ADD COLUMN IF NOT EXISTS soc_style_preferences text;
COMMENT ON COLUMN user_brain_v2.soc_style_preferences IS
  'User SOC Brain v2: explicit stated drafting-style preferences for Schedules of Condition (terminology, sentence construction, level of detail). Distinct from soc_gold_standard, which is an example document, not an instruction set. Examples teach style; this states it directly.';
