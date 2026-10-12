-- Manual "Nora must not respond to this email" switch, and optional finish time on diary entries.
alter table public.emails add column if not exists nora_no_reply boolean not null default false;
alter table public.tasks add column if not exists end_time text;
