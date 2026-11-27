-- 27 Nov 2026. Plans and entitlements, step 1.
-- One row per customer: which plan they are on, whether they are on a trial or locked, and an optional
-- complimentary (free) upgrade set by an admin, either with an end date or indefinitely (until is null).
-- Nothing enforces this yet: api/lib/entitlements.js only records what it would have blocked.
--
-- Rollback: drop trigger on_auth_user_created_plan on auth.users; drop function create_user_plan();
--           drop table entitlement_would_block; drop table user_plans;

create table if not exists public.user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'complete' check (plan in ('essentials', 'inspect', 'complete')),
  status text not null default 'trial' check (status in ('trial', 'active', 'locked')),
  trial_ends_at timestamptz,
  complimentary_plan text check (complimentary_plan in ('essentials', 'inspect', 'complete')),
  complimentary_until timestamptz,          -- null with complimentary_plan set = indefinitely
  complimentary_note text,
  locked_reason text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_plans enable row level security;

-- Customers may read their own row. Only the server (service role) may change plans.
drop policy if exists user_plans_select_own on public.user_plans;
create policy user_plans_select_own on public.user_plans for select using (user_id = auth.uid());

-- What the central check would have refused while it is in record-only mode.
create table if not exists public.entitlement_would_block (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  feature text not null,
  reason text not null,
  effective_plan text
);
alter table public.entitlement_would_block enable row level security;

-- Existing accounts keep working exactly as now: Complete, free, indefinitely.
insert into public.user_plans (user_id, plan, status, complimentary_plan, complimentary_until, complimentary_note, is_admin)
select u.id, 'complete', 'active', 'complete', null, 'Existing account (before plans)', (u.id = '3bd1f331-e8ce-477a-8a5d-c5dcdd901434')
from auth.users u
on conflict (user_id) do nothing;

-- Every new sign-up starts on a 14-day trial of Complete. Never allowed to break sign-up.
create or replace function public.create_user_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_plans (user_id, plan, status, trial_ends_at)
  values (new.id, 'complete', 'trial', now() + interval '14 days')
  on conflict (user_id) do nothing;
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists on_auth_user_created_plan on auth.users;
create trigger on_auth_user_created_plan after insert on auth.users
  for each row execute function public.create_user_plan();
