-- Amendment to the live universal_brain_v2 row, per
-- docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md section 6 (amendment rules).
--
-- Why: the party wall knowledge layer (global_party_wall_knowledge) already
-- carries the case-law library and is loaded on chat and drafting surfaces, but
-- no instruction told Nora WHEN to use it. Whether she reached for a case in a
-- dispute was left to chance.
--
-- Ownership: Universal Brain owns professional capability (section 2). This adds
-- one section; it does not repeat the existing STRATEGIC DRAFT CONSTRUCTION
-- guidance on legal authority, it only says when to use the supplied authority.
-- Whether a dispute exists is a model judgement from the context, not a code
-- test (section 5). No conflict with the section 3 authority hierarchy: it sits
-- beneath the anti-invention safeguards and tightens them (cite only supplied
-- authority).
--
-- Shared by every user. Contains no personal names. Personal attributions
-- belong in a user's own brain.
--
-- Rollback: restore the row from universal_brain_v2_backup_20261126, or
-- UPDATE ai_instruction_sets SET system_prompt = left(system_prompt,
-- position(E'\n\nDISPUTE AUTHORITY' in system_prompt) - 1) WHERE name = 'universal_brain_v2';
--
-- Idempotent.

INSERT INTO public.ai_instruction_sets (name, domain, mode, system_prompt, behaviour_rules, output_rules, active, version, priority, metadata, layer_type)
SELECT 'universal_brain_v2_backup_20261126', domain, mode, system_prompt, behaviour_rules, output_rules, false, version, priority, metadata, layer_type
FROM public.ai_instruction_sets
WHERE name = 'universal_brain_v2'
  AND NOT EXISTS (SELECT 1 FROM public.ai_instruction_sets WHERE name = 'universal_brain_v2_backup_20261126');

UPDATE public.ai_instruction_sets
SET system_prompt = system_prompt || $NEW$


DISPUTE AUTHORITY

Use this only when the conversation shows a genuine disagreement: a surveyor, building owner or adjoining owner contesting a point, resisting a position or refusing something. It may be clear from the emails being read, from the user's own words, or from what another user tells you. Do not use it for routine correspondence such as arranging access, requesting drawings or agreeing dates.

Where a dispute exists, check the party wall knowledge supplied for this request (the cases and their reasoning, Faculty and CPD material, and any statutory reference supplied) for authority that bears on the controlling point, and use the one that fits. Name the case, and cite it only as it appears in that material. Never cite a case, passage or section from memory, and never invent one. If nothing supplied fits, argue from the Act and the facts and do not force a case in. Explain the reasoning that makes the authority apply, not only its name. Give the case name to every recipient, including owners who are not surveyors; for a non-surveyor, state the principle in plain words first and the case name after it.

Practitioner views found in the supplied material may be used as the recognised practice position, but never attribute them to a named individual unless the user's own words or the user's own brain does.$NEW$
WHERE name = 'universal_brain_v2'
  AND system_prompt NOT LIKE '%DISPUTE AUTHORITY%';
