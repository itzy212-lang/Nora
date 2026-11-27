-- 27 Nov 2026. Record of every letter posted through Intelliprint (tracked), per customer.
-- Holds the tracking number (shown as a link on the adjoining-owner card), the page count, what we charged
-- (before VAT) and what it cost us. Later this feeds the Extras statement. Provider-neutral: nothing here
-- depends on the user's email or storage provider.
-- Rollback: drop table public.posted_letters;

create table if not exists public.posted_letters (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null,
  project_id text,
  ao_id text,
  recipient_name text,
  recipient_address text,
  sheets integer not null check (sheets between 1 and 50),
  price_net_pence integer not null,      -- charged to the customer, before VAT
  vat_pence integer not null,
  cost_net_pence integer not null,       -- what Intelliprint charges us, before VAT
  provider text not null default 'intelliprint',
  provider_print_id text,
  tracking_number text,
  status text not null default 'draft',
  testmode boolean not null default true,
  last_status_at timestamptz
);

alter table public.posted_letters enable row level security;

drop policy if exists posted_letters_select_own on public.posted_letters;
create policy posted_letters_select_own on public.posted_letters for select using (user_id = auth.uid());

create index if not exists posted_letters_user_idx on public.posted_letters (user_id, created_at desc);
create index if not exists posted_letters_ao_idx on public.posted_letters (project_id, ao_id);
