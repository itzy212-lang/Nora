create table if not exists public.notice_response_short_links (
 slug text primary key,
 token_hash text not null unique references public.notice_response_links(token_hash),
 user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.notice_response_short_links enable row level security;
create index if not exists notice_response_short_links_user_idx on public.notice_response_short_links(user_id);