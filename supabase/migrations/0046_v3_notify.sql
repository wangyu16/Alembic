-- 0046: Email preferences and the Needs-you email feed (workspace v3, C8;
-- design §6.3, O8).
--
-- notification_prefs: how often a person gets the Needs-you email (weekly by
--   default; daily; off) and the last period it was sent for.
-- notify_due_people / notify_items / notify_mark_sent: service-role only,
--   used by the worker's digest job. Addresses come from auth.users and never
--   leave the service role.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0045.

create table public.notification_prefs (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  email_every     text not null default 'week' check (email_every in ('week', 'day', 'off')),
  last_period_key text,
  updated_at      timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
revoke all on public.notification_prefs from anon, authenticated;
grant select on public.notification_prefs to authenticated;
create policy "own prefs" on public.notification_prefs for select to authenticated using (user_id = (select auth.uid()));

-- The person's own setting (the only member-callable function here).
create function public.set_email_every(p_every text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_every not in ('week', 'day', 'off') then raise exception 'bad setting' using errcode = '22023'; end if;
  insert into public.notification_prefs (user_id, email_every) values ((select auth.uid()), p_every)
  on conflict (user_id) do update set email_every = excluded.email_every, updated_at = now();
end $$;
revoke execute on function public.set_email_every(text) from public, anon;
grant execute on function public.set_email_every(text) to authenticated;

-- People on at least one course whose setting is p_every and who haven't had
-- the email for p_period_key yet.
create function public.notify_due_people(p_every text, p_period_key text)
returns table (user_id uuid, email text, name text)
language sql stable security definer set search_path = '' as $$
  select p.id, u.email::text, coalesce(nullif(p.display_name, ''), p.github_username, 'there')
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.notification_prefs n on n.user_id = p.id
   where coalesce(n.email_every, 'week') = p_every
     and n.last_period_key is distinct from p_period_key
     and u.email is not null and u.email <> ''
     and exists (select 1 from public.course_members m where m.user_id = p.id)
$$;

-- Live items in that person's courses that are for everyone or for them.
create function public.notify_items(p_user uuid)
returns table (id uuid, package_id text, course_title text, kind text, chapter text, title text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select y.id, y.package_id, k.title, y.kind, y.chapter, y.payload ->> 'title', y.created_at
    from public.needs_you y
    join public.course_members m on m.package_id = y.package_id and m.user_id = p_user
    join public.packages k on k.id = y.package_id
   where y.state in ('waiting', 'shown')
     and (cardinality(y.addressed_to) = 0 or p_user = any (y.addressed_to))
   order by k.title, y.created_at
$$;

create function public.notify_mark_sent(p_user uuid, p_period_key text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notification_prefs (user_id, last_period_key) values (p_user, p_period_key)
  on conflict (user_id) do update set last_period_key = excluded.last_period_key, updated_at = now();
$$;

do $$
declare f text;
begin
  foreach f in array array['notify_due_people(text, text)', 'notify_items(uuid)', 'notify_mark_sent(uuid, text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
