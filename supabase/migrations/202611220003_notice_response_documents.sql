alter table public.notice_response_submissions add column if not exists acknowledgement_path text;
alter table public.notice_response_submissions add column if not exists certificate_path text;
alter table public.notice_response_submissions add column if not exists delivery_status text not null default 'pending';
alter table public.notice_response_submissions add column if not exists finalised_at timestamptz;
create unique index if not exists notice_response_submissions_one_pending_per_email on public.notice_response_submissions(link_id, signer_email) where status = 'pending_verification';
