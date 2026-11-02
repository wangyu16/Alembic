-- 0063: course operations (package-contract-v3 §13.3; G0 rounds 2-3).
--
-- The course settings (alembic.json) change only through named operations,
-- queued as rows of the new kind 'courseop' (the operation and its
-- arguments, an actor always). The committer re-checks the actor's right
-- and applies the operation to the manifest at the head, so operations made
-- at the same moment land one after another. Publish waits while any is on
-- its way (by kind, not by key pattern; the older system rows that changed
-- the manifest are still matched during the switch-over).
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0062; before the web app
-- that queues 'courseop' rows (the worker understands them first).

do $$
declare r record;
begin
  -- The kind list and the actor rule were unnamed checks in 0037: find them by their definition.
  for r in
    select conname from pg_constraint
     where conrelid = 'public.write_queue'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%changeset%'
  loop
    execute format('alter table public.write_queue drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.write_queue
  add constraint write_queue_kind_check
    check (kind in ('sync', 'changeset', 'outside', 'restore', 'system', 'courseop')),
  add constraint write_queue_actor_check
    check ((kind in ('sync', 'restore', 'courseop') and actor_id is not null)
        or (kind = 'changeset' and invoker_id is not null)
        or kind in ('outside', 'system'));

create or replace function public.request_publish(p text, p_choices jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role text := public.course_role(p); v_id uuid; v_status text;
begin
  if coalesce(v_role, '') not in ('owner', 'deputy') then
    raise exception 'Only the owner or deputy publishes' using errcode = '42501';
  end if;
  if jsonb_typeof(p_choices) <> 'object'
     or jsonb_typeof(coalesce(p_choices->'publishAnyway', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_choices->'approveAndPublish', '[]')) <> 'array'
     or length(p_choices::text) > 20000 then
    raise exception 'Malformed publish choices' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('publish_request:' || p, 0));
  -- Any course operation still on its way (contract v3 §13.3), checked by kind; and, for the switch-over,
  -- the older system rows that changed the manifest directly.
  if exists (select 1 from public.write_queue where package_id = p and status in ('queued', 'processing', 'retry')
              and (kind = 'courseop' or idem_key like 'system:mode:%' or idem_key like 'system:chapters:add:%')) then
    raise exception 'A chapter status change is still being saved' using errcode = '55006';
  end if;
  select id, status into v_id, v_status from public.publish_requests where package_id = p and status in ('queued', 'running') limit 1 for update;
  if v_status = 'running' then
    raise exception 'Publish is already running' using errcode = '55006';
  end if;
  if v_id is not null then
    update public.publish_requests set by_user = (select auth.uid()), created_at = now(), choices = jsonb_build_object(
      'publishAnyway', coalesce(p_choices->'publishAnyway', '[]'),
      'approveAndPublish', coalesce(p_choices->'approveAndPublish', '[]'))
     where id = v_id and status = 'queued';
    if not found then raise exception 'Publish is already running' using errcode = '55006'; end if;
    return v_id;
  end if;
  insert into public.publish_requests (package_id, by_user, choices)
  values (p, (select auth.uid()), jsonb_build_object(
    'publishAnyway', coalesce(p_choices->'publishAnyway', '[]'),
    'approveAndPublish', coalesce(p_choices->'approveAndPublish', '[]')))
  returning id into v_id;
  return v_id;
end $$;
