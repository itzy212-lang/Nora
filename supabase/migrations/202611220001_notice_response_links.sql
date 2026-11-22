-- Public response links are stored separately from notice records.
-- No anonymous Data API policies: access is exclusively via authenticated server endpoints.
create table if not exists public.notice_response_links (
 id uuid primary key default gen_random_uuid(),
 notice_id uuid not null references public.notices(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 token_hash text not null unique,
 pdf_bucket text not null,
 pdf_path text not null,
 original_pdf_sha256 text not null,
 original_pdf_bytes bigint not null check(original_pdf_bytes > 0),
 created_at timestamptz not null default now(),
 expires_at timestamptz,
 revoked_at timestamptz,
 unique(notice_id, original_pdf_sha256)
);
alter table public.notice_response_links enable row level security;
create index if not exists notice_response_links_notice_idx on public.notice_response_links(notice_id);
create table if not exists public.notice_response_submissions (
 id uuid primary key default gen_random_uuid(),
 link_id uuid not null references public.notice_response_links(id),
 choice text not null check(choice in ('consent','consent_soc','dissent_agreed','dissent_own')),
 signer_name text not null,
 signer_email text not null,
 surveyor jsonb,
 email_verified_at timestamptz,
 signed_at timestamptz,
 submitted_at timestamptz not null default now(),
 status text not null default 'pending_verification' check(status in ('pending_verification','verified','finalised')),
 verification_hash text,
 verification_expires_at timestamptz,
 audit jsonb not null default '{}'::jsonb
);
alter table public.notice_response_submissions enable row level security;
create unique index if not exists notice_response_submissions_one_active on public.notice_response_submissions(link_id) where status in ('verified','finalised');
