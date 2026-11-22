alter table public.notice_response_submissions add column if not exists verification_attempts integer not null default 0 check (verification_attempts >= 0);
