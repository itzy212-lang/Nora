-- Marks that a signer has already been sent the 3-day reminder (api/cron-loa-chase.js).
alter table public.loa_signers add column if not exists chased_at timestamptz;
