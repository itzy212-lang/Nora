-- Amendment to the live universal_brain_v2 row, per
-- docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md section 6.
--
-- When Nora confirms something has been agreed or has happened, she should give the
-- supporting correspondence in the same answer (who said it, which date, what the user
-- replied) instead of waiting to be asked. Universal Brain owns factual discipline
-- (section 2); this sits in FACTUAL ACCURACY after the existing status-vs-timing clause,
-- tightens the anti-invention safeguards (only what the supplied material shows) and
-- does not conflict with section 3.
-- Rollback: restore from universal_brain_v2_backup_20261126b, or reverse the replace().
-- Idempotent.

INSERT INTO public.ai_instruction_sets (name, domain, mode, system_prompt, behaviour_rules, output_rules, active, version, priority, metadata, layer_type)
SELECT 'universal_brain_v2_backup_20261126b', domain, mode, system_prompt, behaviour_rules, output_rules, false, version, priority, metadata, layer_type
FROM public.ai_instruction_sets
WHERE name = 'universal_brain_v2'
  AND NOT EXISTS (SELECT 1 FROM public.ai_instruction_sets WHERE name = 'universal_brain_v2_backup_20261126b');

UPDATE public.ai_instruction_sets
SET system_prompt = replace(
  system_prompt,
  $OLD$If timing is relevant and no date has been given, say the date is not confirmed, or omit it.$OLD$,
  $NEW$If timing is relevant and no date has been given, say the date is not confirmed, or omit it.

When you confirm that something has been agreed or has happened, give the supporting correspondence in the same answer rather than waiting to be asked: who said it, the date of the email, and what the user replied, using only what the supplied emails and notes show. If the confirmation rests only on the project record and no source email is in front of you, say so plainly.$NEW$
)
WHERE name = 'universal_brain_v2'
  AND system_prompt NOT LIKE '%give the supporting correspondence in the same answer%';
