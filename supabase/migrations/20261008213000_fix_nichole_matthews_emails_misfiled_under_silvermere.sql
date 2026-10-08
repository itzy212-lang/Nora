-- Data repair, 2026-10-08 (already applied live). Six emails belonging to
-- Nichole Matthews' loft-conversion lead (lead_f0727237, SQ1-LD-2026-0007)
-- were filed under the unrelated Silvermere Road project
-- (proj_1783057071346_3l2ukx6) by the subject-line rule in
-- auto_link_incoming_email_on_insert ("Party Wall Matters" is a generic
-- subject). Nora then auto-sent her Silvermere's confidential appointment
-- details. Moved to her actual lead. ef239f89 (a 15 Sept forward with no
-- recorded recipient) is deliberately left alone rather than guessed at.
UPDATE public.emails
SET project_id = 'lead_f0727237',
    link_status = 'manual_linked',
    link_reason = 'Corrected 2026-10-08: was auto-linked to an unrelated project by identical subject line',
    linked_by = 'manual_correction',
    linked_at = now(),
    manually_linked = true
WHERE project_id = 'proj_1783057071346_3l2ukx6'
  AND id IN (
    '0707315c-b6e2-4898-9222-01221c871231',
    'cac459d9-a6fd-4da0-8dfc-71aa70e3c086',
    '1c834a07-71fd-43af-aba0-aa5c61576e09',
    'e5ceab56-cd78-472f-a1f9-96db45ef3e3b',
    '820d03d0-4c4a-4f38-84a7-a3f429c58452',
    '158f2c25-27c3-4939-be1e-7a02801bcfa1'
  );

UPDATE public.email_auto_drafts
SET project_id = 'lead_f0727237'
WHERE email_id = 'e5ceab56-cd78-472f-a1f9-96db45ef3e3b';
