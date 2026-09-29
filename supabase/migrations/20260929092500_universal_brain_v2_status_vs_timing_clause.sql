-- Amendment to the live universal_brain_v2 row, per
-- docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md §6 (amendment rules).
--
-- Root cause (2026-09-25/29): a drafted reply stated a Schedule of
-- Condition "was completed today, 25 September 2026" with no diary
-- record supporting that date. The source material only said the SOC
-- had been "completed so far" (i.e. as of the date an earlier email was
-- sent) - a status statement, not a dated claim. The existing
-- FACTUAL ACCURACY paragraph already bars inventing a date "unless
-- explicitly established in the supplied context", but did not
-- specifically address this failure mode: converting a vague status
-- into a precise dated claim by attaching today's date or the date of
-- the message reporting the status.
--
-- This migration adds one clause to the existing FACTUAL ACCURACY
-- section of universal_brain_v2, immediately after its existing
-- traceability-check sentence. It does not create a new component or
-- owner (Universal Brain already owns anti-invention/factual accuracy
-- per §2), and does not conflict with the authority hierarchy in §3
-- (a factual/representation safeguard, which sits above voice/style
-- and cannot be overridden downstream).
--
-- Idempotent: only replaces the anchor text if the new clause is not
-- already present, so re-running this migration on an environment
-- where it already applied is a no-op.
--
-- Rollback: UPDATE public.ai_instruction_sets SET system_prompt =
-- replace(system_prompt, E'\n\nA statement of status or progress ("completed", "completed so far", "done", "in progress", "outstanding") describes condition, not a date. Do not attach a specific date - including today''s date or the date of the message reporting the status - to an event, milestone or action unless that exact date is explicitly stated in the source material as the date it occurred. Do not infer that something happened on the date it was mentioned, reported or sent. If timing is relevant and no date has been given, say the date is not confirmed, or omit it.', '') WHERE name = 'universal_brain_v2';

UPDATE public.ai_instruction_sets
SET system_prompt = replace(
  system_prompt,
  $OLD$Before returning a draft, verify that every specific figure, date, measurement, statutory citation, reference number, address and named person is traceable to the supplied context; if not traceable, remove it or generalise it.$OLD$,
  $NEW$Before returning a draft, verify that every specific figure, date, measurement, statutory citation, reference number, address and named person is traceable to the supplied context; if not traceable, remove it or generalise it.

A statement of status or progress ("completed", "completed so far", "done", "in progress", "outstanding") describes condition, not a date. Do not attach a specific date - including today's date or the date of the message reporting the status - to an event, milestone or action unless that exact date is explicitly stated in the source material as the date it occurred. Do not infer that something happened on the date it was mentioned, reported or sent. If timing is relevant and no date has been given, say the date is not confirmed, or omit it.$NEW$
)
WHERE name = 'universal_brain_v2'
  AND system_prompt NOT LIKE '%A statement of status or progress%';
