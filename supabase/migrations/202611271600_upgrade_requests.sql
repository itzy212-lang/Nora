-- 27 Nov 2026. A signed-in user asking for a bolt-on (Nora Assistant / Schedule of Condition). Shown on the Admin page
-- and cleared when the bolt-on is switched on. (Already applied; saved here so the repo matches the database.)
-- Rollback: drop table public.upgrade_requests;
create table if not exists public.upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null,
  addon text not null,
  handled_at timestamptz
);
alter table public.upgrade_requests enable row level security;
create unique index if not exists upgrade_requests_open_idx on public.upgrade_requests (user_id, addon) where handled_at is null;
