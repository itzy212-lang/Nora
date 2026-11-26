-- Adds the reasoning behind Leadbetter and the practitioner caution on long
-- inactivity to the "Notice expiry after dissent" entry of the shared
-- global_party_wall_knowledge layer. Knowledge layer informs reasoning, never
-- style (its own stated purpose). No personal names; shared by every user.
-- Operating System doc section 6: no new component or owner; Universal Brain
-- still owns when to use it (DISPUTE AUTHORITY).
--
-- Rollback: restore from global_party_wall_knowledge_backup_20261126.
-- Idempotent.

INSERT INTO public.ai_instruction_sets (name, domain, mode, system_prompt, behaviour_rules, output_rules, active, version, priority, metadata, layer_type)
SELECT 'global_party_wall_knowledge_backup_20261126', domain, mode, system_prompt, behaviour_rules, output_rules, false, version, priority, metadata, layer_type
FROM public.ai_instruction_sets
WHERE name = 'global_party_wall_knowledge'
  AND NOT EXISTS (SELECT 1 FROM public.ai_instruction_sets WHERE name = 'global_party_wall_knowledge_backup_20261126');

UPDATE public.ai_instruction_sets
SET system_prompt = replace(
  system_prompt,
  $OLD$Serving fresh notices after dissent may be unnecessary and potentially harmful unless there has been a material change to the works.$OLD$,
  $NEW$Serving fresh notices after dissent may be unnecessary and potentially harmful unless there has been a material change to the works.

Why the principle holds: Parliament enacted the 1996 Act (and its predecessors) knowing of Leadbetter and did not amend the relevant provisions, so the Act is read in line with it. Notices do not lapse mid-process simply because the award has not been perfected within six months, even if more than a year passes while the building owner gathers information such as trial pits, engineer designs or surveys.

Practice caution: where there has been a long period of inactivity, some practitioners serve a further notice as a precaution against giving grounds for appeal on a later award, particularly if the scheme has changed materially. That is prudence, not a legal requirement, and it does not undermine the principle above.$NEW$
)
WHERE name = 'global_party_wall_knowledge'
  AND system_prompt NOT LIKE '%Why the principle holds: Parliament%';
