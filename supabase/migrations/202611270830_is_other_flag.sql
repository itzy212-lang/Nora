-- 27 Nov 2026: replace emails.inbox_class (text, nullable) with emails.is_other (boolean, default false).
-- A constant default is stored as table metadata, so every existing email reads as false with no row
-- rewrite and no triggers firing, and queries stay simple (no NULL special-casing).
-- inbox_class was added minutes earlier and nothing had written to it yet.
alter table public.emails add column if not exists is_other boolean not null default false;
drop index if exists public.emails_inbox_class_idx;
alter table public.emails drop column if exists inbox_class;
create index if not exists emails_is_other_idx on public.emails (is_other) where is_other;

create or replace function public.trigger_send_email_push()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
BEGIN
  IF NEW.is_other THEN RETURN NEW; END IF;
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

create or replace function public.auto_link_incoming_email_on_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_project_id text;
  v_subject text;
begin
  if new.project_id is not null then
    return new;
  end if;
  if new.is_other then
    return new;
  end if;

  v_subject := lower(trim(regexp_replace(coalesce(new.subject,''), '^(re|fw|fwd):\s*', '', 'i')));

  if new.thread_id is not null then
    select e.project_id into v_project_id
    from public.emails e
    where e.thread_id = new.thread_id
      and e.project_id is not null
    order by coalesce(e.sent_at,e.received_at,e.created_at) desc
    limit 1;
  end if;

  if v_project_id is null and v_subject <> '' then
    select min(e.project_id) into v_project_id
    from public.emails e
    where e.project_id is not null
      and lower(trim(regexp_replace(coalesce(e.subject,''), '^(re|fw|fwd):\s*', '', 'i'))) = v_subject
    having count(distinct e.project_id) = 1;
  end if;

  if v_project_id is null then
    select p.id into v_project_id
    from public.projects p
    where p.status <> 'closed'
      and coalesce(p.ref,'') <> ''
      and public.contains_whole_phrase(coalesce(new.subject,'') || ' ' || coalesce(new.body_preview,''), p.ref)
    limit 1;
  end if;

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
