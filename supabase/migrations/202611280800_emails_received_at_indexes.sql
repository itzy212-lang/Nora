-- 28 Nov 2026. The inbox loads every folder at once, each ordered by received date. Nothing was indexed on that
-- column, so the sorts timed out ("canceling statement due to statement timeout"). These make each load instant.
-- Rollback: drop index emails_received_at_idx, emails_sent_received_at_idx, emails_other_received_at_idx;
create index if not exists emails_received_at_idx on public.emails (received_at desc nulls last);
create index if not exists emails_sent_received_at_idx on public.emails (received_at desc nulls last) where is_sent;
create index if not exists emails_other_received_at_idx on public.emails (received_at desc nulls last) where is_other;
analyze public.emails;
