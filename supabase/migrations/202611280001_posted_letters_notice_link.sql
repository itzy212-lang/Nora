-- 28 Nov 2026. A hard copy of an already-served notice is posted as its own letter, linked to that notice
-- (so the AO card can show "Hard copy posted dd/mm/yyyy" under it) without changing how the notice itself was served.
-- Rollback: alter table public.posted_letters drop column notice_id;
alter table public.posted_letters add column if not exists notice_id uuid;
create index if not exists posted_letters_notice_idx on public.posted_letters (notice_id) where notice_id is not null;
