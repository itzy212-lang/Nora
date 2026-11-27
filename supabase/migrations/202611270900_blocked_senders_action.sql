-- 27 Nov 2026: a sender rule can now also route future mail to the Others folder instead of blocking it.
alter table public.blocked_senders add column if not exists action text not null default 'block';
alter table public.blocked_senders drop constraint if exists blocked_senders_action_check;
alter table public.blocked_senders add constraint blocked_senders_action_check check (action in ('block', 'others'));
