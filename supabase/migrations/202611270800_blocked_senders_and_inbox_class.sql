-- 27 Nov 2026
-- 1) blocked_senders: senders (or whole domains) a user has marked as junk. The mail sync checks this
--    before saving anything, so blocked mail is never stored, embedded, classified or notified.
--    Plain database rows and plain code: no AI is involved.
-- 2) emails.inbox_class: 'other' for mail the provider itself filed outside the main inbox
--    (Outlook "Other", Gmail Promotions/Social/Forums). Nora keeps these for reading in the Others folder
--    but does nothing else with them. NULL / 'focused' = normal mail.
-- 3) contains_whole_phrase(): word-boundary text match, so "1 Nether Street" no longer matches inside
--    "121 Nether Street" (the cause of a Voipfone invoice being linked to a project).

create table if not exists public.blocked_senders (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,                       -- same value as emails.user_id (uuid or login email)
  kind text not null check (kind in ('email', 'domain')),
  value text not null,                         -- lower case address or domain
  created_at timestamptz not null default now(),
  unique (user_id, kind, value)
);
create index if not exists blocked_senders_user_idx on public.blocked_senders (user_id);
alter table public.blocked_senders enable row level security;
drop policy if exists users_own_blocked_senders on public.blocked_senders;
create policy users_own_blocked_senders on public.blocked_senders for all
  using ((user_id = (auth.uid())::text) or (user_id = (auth.jwt() ->> 'email'::text)))
  with check ((user_id = (auth.uid())::text) or (user_id = (auth.jwt() ->> 'email'::text)));

alter table public.emails add column if not exists inbox_class text;
create index if not exists emails_inbox_class_idx on public.emails (inbox_class) where inbox_class is not null;

create or replace function public.contains_whole_phrase(hay text, needle text)
returns boolean language sql immutable as $$
  select coalesce(needle, '') <> '' and coalesce(hay, '') ~* (
    '(^|[^a-z0-9])' || regexp_replace(needle, '([\.\^\$\*\+\?\(\)\[\]\{\}\|\\])', '\\\1', 'g') || '([^a-z0-9]|$)'
  )
$$;

-- Push notification: nothing for mail filed under Others.
create or replace function public.trigger_send_email_push()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
BEGIN
  IF NEW.inbox_class = 'other' THEN RETURN NEW; END IF;
  IF (NEW.direction = 'incoming' OR (NEW.direction IS NULL AND NEW.is_sent IS NOT TRUE)) THEN
    PERFORM net.http_post(
      url := 'https://nora-d9wy.vercel.app/api/send-email-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'send_email_push_trigger_secret')
      ),
      body := jsonb_build_object('email_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Auto-link: skip Others mail, and match references / addresses as whole phrases only.
create or replace function public.auto_link_incoming_email_on_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_project_id text;
  v_subject text;
begin
  if new.project_id is not null then
    return new;
  end if;
  if new.inbox_class = 'other' then
    return new;
  end if;

  v_subject := lower(trim(regexp_replace(coalesce(new.subject,''), '^(re|fw|fwd):\s*', '', 'i')));

  -- 1. Inherit from an already linked Outlook conversation.
  if new.thread_id is not null then
    select e.project_id into v_project_id
    from public.emails e
    where e.thread_id = new.thread_id
      and e.project_id is not null
    order by coalesce(e.sent_at,e.received_at,e.created_at) desc
    limit 1;
  end if;

  -- 2. Inherit from the same email subject where every linked copy belongs to one project.
  if v_project_id is null and v_subject <> '' then
    select min(e.project_id) into v_project_id
    from public.emails e
    where e.project_id is not null
      and lower(trim(regexp_replace(coalesce(e.subject,''), '^(re|fw|fwd):\s*', '', 'i'))) = v_subject
    having count(distinct e.project_id) = 1;
  end if;

  -- 3. Project reference in subject/body.
  if v_project_id is null then
    select p.id into v_project_id
    from public.projects p
    where p.status <> 'closed'
      and coalesce(p.ref,'') <> ''
      and public.contains_whole_phrase(coalesce(new.subject,'') || ' ' || coalesce(new.body_preview,''), p.ref)
    limit 1;
  end if;

  -- 4. Full property address in subject/body.
  if v_project_id is null then
    select p.id into v_project_id
    from public.projects p
    where p.status <> 'closed'
      and (
        public.contains_whole_phrase(coalesce(new.subject,'') || ' ' || coalesce(new.body_preview,''), p.bo_premise_address)
        or
        public.contains_whole_phrase(coalesce(new.subject,'') || ' ' || coalesce(new.body_preview,''), p.ao_premise_address)
      )
    limit 1;
  end if;

  -- 5. Sender against project owner/surveyor contacts.
  if v_project_id is null and coalesce(new.sender_email,'') <> '' then
    select p.id into v_project_id
    from public.projects p
    where p.status <> 'closed'
      and (
        coalesce(p.bo_1_email,'') ilike new.sender_email
        or coalesce(p.bo_2_email,'') ilike new.sender_email
        or coalesce(p.ao_email,'') ilike new.sender_email
        or coalesce(p.bos_email,'') ilike new.sender_email
        or exists (
          select 1 from jsonb_array_elements(
            case when p.aos is not null and jsonb_typeof(p.aos::jsonb)='array' then p.aos::jsonb else '[]'::jsonb end
          ) ao
          where coalesce(ao->>'email','') ilike new.sender_email
             or coalesce(ao->>'email2','') ilike new.sender_email
             or coalesce(ao->>'surv_email','') ilike new.sender_email
             or coalesce(ao->>'surveyorEmail','') ilike new.sender_email
        )
      )
    limit 1;
  end if;

  if v_project_id is null and coalesce(new.sender_email,'') <> '' then
    select ao.project_id into v_project_id
    from public.adjoining_owners ao
    join public.projects p on p.id = ao.project_id
    where p.status <> 'closed'
      and (
        coalesce(ao.email,'') ilike new.sender_email
        or coalesce(ao.surveyor_email,'') ilike new.sender_email
        or coalesce(ao.third_surveyor_email,'') ilike new.sender_email
      )
    limit 1;
  end if;

  if v_project_id is not null then
    update public.emails
    set project_id = v_project_id,
        link_status = 'auto_linked',
        link_reason = 'Automatically linked on email ingestion',
        link_confidence = 1.0,
        linked_by = 'auto_link_ingestion',
        linked_at = now()
    where id = new.id;
  end if;

  return new;
end;
$function$;
