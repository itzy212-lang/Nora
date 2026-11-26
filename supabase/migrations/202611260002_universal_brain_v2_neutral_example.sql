-- Amendment to the live universal_brain_v2 row, per
-- docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md section 6.
--
-- The shared brain is read by every user, so its worked example must not name a
-- real person. Replaces "Stephen's position" with a neutral phrase. Wording
-- otherwise unchanged; no new component or owner; no conflict with section 3.
--
-- Rollback: restore from universal_brain_v2_backup_20261126 (taken before the
-- DISPUTE AUTHORITY section was added), then re-apply
-- 202611260001_universal_brain_v2_dispute_authority.sql, or reverse the replace().
-- Idempotent.

UPDATE public.ai_instruction_sets
SET system_prompt = replace(system_prompt,
  $OLD$"Stephen's position is entirely consistent with Leadbetter on that point"$OLD$,
  $NEW$"That position is entirely consistent with Leadbetter on that point"$NEW$)
WHERE name = 'universal_brain_v2';
