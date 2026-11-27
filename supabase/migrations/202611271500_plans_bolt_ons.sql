-- 27 Nov 2026. Plans become Core + bolt-ons (instead of Essentials / Inspect / Complete).
--   Core £20 (everyone), Schedule of Condition +£20 ('soc'), Nora Assistant +£39 ('assistant'). All three = £79.
-- addons               = bolt-ons the customer pays for.
-- complimentary_addons = free access set by an admin: null = none; an array (even empty) = free Core plus those
--                        bolt-ons, until complimentary_until, or indefinitely when that is null.
-- Nothing reads the old plan columns yet (entitlements are record-only), so they are replaced here.
--
-- Rollback: add back plan / complimentary_plan text columns and drop addons / complimentary_addons.

alter table public.user_plans add column if not exists addons text[] not null default '{}';
alter table public.user_plans add column if not exists complimentary_addons text[];

update public.user_plans set addons = case plan
  when 'inspect'  then array['soc']
  when 'complete' then array['soc','assistant']
  else '{}'::text[] end
where plan is not null;

update public.user_plans set complimentary_addons = case complimentary_plan
  when 'inspect'  then array['soc']
  when 'complete' then array['soc','assistant']
  else '{}'::text[] end
where complimentary_plan is not null;

alter table public.user_plans drop column if exists plan;
alter table public.user_plans drop column if exists complimentary_plan;

alter table public.user_plans drop constraint if exists user_plans_addons_valid;
alter table public.user_plans add constraint user_plans_addons_valid
  check (addons <@ array['soc','assistant'] and (complimentary_addons is null or complimentary_addons <@ array['soc','assistant']));

-- New sign-ups: 14-day trial (the trial gives everything). Never allowed to break sign-up.
create or replace function public.create_user_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_plans (user_id, status, trial_ends_at)
  values (new.id, 'trial', now() + interval '14 days')
  on conflict (user_id) do nothing;
  return new;
exception when others then
  return new;
end $$;
