alter table public.documents add column if not exists metadata jsonb not null default '{}'::jsonb;
