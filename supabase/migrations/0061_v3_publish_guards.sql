-- 0061: Publish guards (real-course loop, audit r3 L9, L10).
--
-- approve_part: a non-member's or banned user's role is null and must be
-- refused by the check itself, not only by the NOT NULL constraint after it.
-- request_publish: refused while a chapter status change (a system row on
-- the manifest) is still on its way, so a Publish can't take a chapter's old
-- status; the page waits too, this closes the check-then-act gap.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0060.

create or replace function public.approve_part(p text, p_path text, p_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text := public.course_role(p);
begin
  if coalesce(v_role, '') not in ('owner', 'deputy') then
    raise exception 'Only the owner or deputy approves the course plan' using errcode = '42501';
  end if;
  insert into public.approvals (package_id, part_path, version, approver_id, approver_role)
  values (p, p_path, p_version, (select auth.uid()), v_role)
  on conflict do nothing;
end $$;

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
  if exists (select 1 from public.write_queue where package_id = p and idem_key like 'system:mode:%'
              and status in ('queued', 'processing', 'retry')) then
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
