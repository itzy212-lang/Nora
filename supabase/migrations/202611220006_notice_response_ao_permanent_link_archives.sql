create table if not exists public.notice_response_archives (
 notice_id uuid primary key references public.notices(id) on delete cascade,
 link_id uuid not null references public.notice_response_links(id) on delete cascade,
 pdf_bucket text not null default 'documents',
 pdf_path text not null unique,
 pdf_sha256 text not null,
 pdf_bytes bigint not null check(pdf_bytes>0),
 archived_at timestamptz not null default now()
);
alter table public.notice_response_archives enable row level security;
create index if not exists notice_response_archives_link_idx on public.notice_response_archives(link_id,archived_at desc);
