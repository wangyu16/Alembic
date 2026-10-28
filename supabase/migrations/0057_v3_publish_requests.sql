-- 0057: Publish requests (workspace v3, A11; queue-and-jobs-v3 §5).
--
-- The Publish button asks; the worker runs. request_publish records who asked
-- and their choices (owner or deputy only: the job re-checks the role at
-- execution, and the first Publish is the owner's). The worker claims one
-- request per course at a time (the partial unique index makes a second
-- 'running' row for the same course impossible) and writes the outcome.
-- The request id is the publish run id (the commit trailer).
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any.

create table public.publish_requests (
  id          uuid primary key default gen_random_uuid(),
  package_id  text not null references public.packages (id) on delete cascade,
  by_user     uuid not null references public.profiles (id),
  choices     jsonb not null default '{"publishAnyway": [], "approveAndPublish": []}',
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  outcome     jsonb,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index publish_requests_due on public.publish_requests (created_at) where status = 'queued';
create unique index publish_requests_one_running on public.publish_requests (package_id) where status = 'running';

alter table public.publish_requests enable row level security;
revoke all on public.publish_requests from anon, authenticated;
grant select on public.publish_requests to authenticated;
create policy "members read" on public.publish_requests for select to authenticated
  using ((select public.course_role(package_id)) is not null);

-- request_publish: owner or deputy asks for a Publish. One open request per
-- course: asking again while one is queued or running returns that one.
create function public.request_publish(p text, p_choices jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role text := public.course_role(p); v_id uuid;
begin
  if v_role not in ('owner', 'deputy') then
    raise exception 'Only the owner or deputy publishes' using errcode = '42501';
  end if;
  if jsonb_typeof(p_choices) <> 'object'
     or jsonb_typeof(coalesce(p_choices->'publishAnyway', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_choices->'approveAndPublish', '[]')) <> 'array'
     or length(p_choices::text) > 20000 then
    raise exception 'Malformed publish choices' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('publish_request:' || p, 0));
  select id into v_id from public.publish_requests where package_id = p and status in ('queued', 'running') limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.publish_requests (package_id, by_user, choices)
  values (p, (select auth.uid()), jsonb_build_object(
    'publishAnyway', coalesce(p_choices->'publishAnyway', '[]'),
    'approveAndPublish', coalesce(p_choices->'approveAndPublish', '[]')))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.request_publish(text, jsonb) from public, anon;
grant execute on function public.request_publish(text, jsonb) to authenticated;

-- claim_publish_request: the worker takes the oldest queued request of a
-- course with nothing running; a run left 'running' for 20 minutes (a worker
-- died) is failed first so its course can publish again (its pending record
-- is recovered from the commit trailer by the next run).
create function public.claim_publish_request()
returns setof public.publish_requests language plpgsql security definer set search_path = '' as $$
begin
  update public.publish_requests set status = 'failed', finished_at = now(),
         outcome = jsonb_build_object('status', 'stopped', 'reason', 'Publish stopped unexpectedly; run it again')
   where status = 'running' and started_at < now() - interval '20 minutes';
  return query
  update public.publish_requests r set status = 'running', started_at = now()
   where r.id = (
     select q.id from public.publish_requests q
      where q.status = 'queued'
        and not exists (select 1 from public.publish_requests x where x.package_id = q.package_id and x.status = 'running')
      order by q.created_at limit 1
      for update skip locked)
  returning r.*;
end $$;
revoke execute on function public.claim_publish_request() from public, anon, authenticated;
grant execute on function public.claim_publish_request() to service_role;
