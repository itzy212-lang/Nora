alter table public.firm_settings add column if not exists lead_autoreply jsonb;

create table if not exists public.lead_autoreply_log (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null unique references public.emails(id) on delete cascade,
  user_id uuid not null,
  status text not null,
  kind text,
  reply_kind text,
  lead jsonb,
  reply_subject text,
  reply_body text,
  project_id text,
  handled_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.lead_autoreply_log enable row level security;
create policy "users read own lead log" on public.lead_autoreply_log for select using (auth.uid() = user_id);
