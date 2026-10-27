-- 0036: course membership (workspace v3, module A2) — additive.
--
-- docs/specs/v3/permissions-v3.md. Adds owners/co-authors/deputies per course,
-- a role function for RLS, member read access to course rows, invitations,
-- and the definer functions that are the ONLY way to change membership.
--
-- Additive on purpose: today's owner-only write policies are untouched (the
-- grant tightening on packages.manifest / documents sharing lands with the
-- queue-based write path, in a later migration). Nothing here lets a member
-- write anything directly.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any (no code depends on it yet).

-- ---------------------------------------------------------------------------
-- course_members
-- ---------------------------------------------------------------------------
create table public.course_members (
  package_id   text not null references public.packages (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null check (role in ('owner', 'co-author')),
  deputy_until timestamptz,
  added_by     uuid references public.profiles (id),
  added_at     timestamptz not null default now(),
  primary key (package_id, user_id),
  check (role = 'co-author' or deputy_until is null)
);
create unique index course_members_one_owner on public.course_members (package_id) where role = 'owner';
create index course_members_user_idx on public.course_members (user_id);

alter table public.course_members enable row level security;
revoke all on public.course_members from anon, authenticated;
grant select on public.course_members to authenticated;

-- Backfill: every existing package's owner becomes its owner member.
insert into public.course_members (package_id, user_id, role)
select p.id, p.owner_id, 'owner' from public.packages p
on conflict do nothing;

-- New packages (today's create path inserts into packages directly): the
-- owner member row follows automatically, in the same transaction.
create function public.course_members_on_package_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.course_members (package_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end $$;
revoke execute on function public.course_members_on_package_insert() from public, anon, authenticated;
create trigger course_members_on_package_insert
  after insert on public.packages
  for each row execute function public.course_members_on_package_insert();

-- ---------------------------------------------------------------------------
-- course_role(p): the caller's role in a course, or null. Bans (0017/0018)
-- apply: an inactive user has no role anywhere.
-- ---------------------------------------------------------------------------
create function public.course_role(p text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not public.is_active_user() then null
    else (
      select case
        when m.role = 'owner' then 'owner'
        when m.deputy_until is not null and m.deputy_until > now() then 'deputy'
        else 'co-author'
      end
      from public.course_members m
      where m.package_id = p and m.user_id = (select auth.uid())
    )
  end
$$;
revoke execute on function public.course_role(text) from public, anon;
grant execute on function public.course_role(text) to authenticated, service_role;

create policy "members read membership" on public.course_members
  for select to authenticated
  using ((select public.course_role(package_id)) is not null);

-- Members read their course's package row and documents (writes unchanged:
-- still owner-only through the existing policies).
create policy "members read package" on public.packages
  for select to authenticated
  using ((select public.course_role(id)) is not null);

create policy "members read documents" on public.documents
  for select to authenticated
  using ((select public.course_role(package_id)) is not null);

-- Fellow members' names.
create function public.course_member_profiles(p text)
returns table (user_id uuid, role text, deputy_until timestamptz, github_username text, display_name text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.role, m.deputy_until, pr.github_username, pr.display_name
  from public.course_members m
  join public.profiles pr on pr.id = m.user_id
  where m.package_id = p and public.course_role(p) is not null
  order by m.role desc, m.added_at
$$;
revoke execute on function public.course_member_profiles(text) from public, anon;
grant execute on function public.course_member_profiles(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table public.course_invitations (
  id            uuid primary key default gen_random_uuid(),
  package_id    text not null references public.packages (id) on delete cascade,
  invitee_login text not null,
  role          text not null default 'co-author' check (role = 'co-author'),
  token_hash    text not null unique,
  invited_by    uuid not null references public.profiles (id),
  expires_at    timestamptz not null,
  accepted_by   uuid references public.profiles (id),
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.course_invitations enable row level security;
revoke all on public.course_invitations from anon, authenticated;
-- No policies: only the definer functions below touch it.

-- invite(p, login, token_hash): owner only. The server makes a 32-byte random
-- token, keeps only its SHA-256 here, and sends the token in the link.
create function public.invite_member(p text, p_login text, p_token_hash text, p_days int default 14)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if public.course_role(p) is distinct from 'owner' then
    raise exception 'Only the owner can invite' using errcode = '42501';
  end if;
  if p_login is null or length(trim(p_login)) = 0 or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Bad invitation' using errcode = '22023';
  end if;
  insert into public.course_invitations (package_id, invitee_login, token_hash, invited_by, expires_at)
  values (p, lower(trim(p_login)), p_token_hash, (select auth.uid()), now() + make_interval(days => least(greatest(p_days, 1), 30)))
  returning id into v_id;
  return v_id;
end $$;

-- accept_invitation(token_hash): single use, unexpired, and only by the
-- invited GitHub account.
create function public.accept_invitation(p_token_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  inv public.course_invitations;
  v_login text;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into inv from public.course_invitations where token_hash = p_token_hash for update;
  if not found or inv.accepted_by is not null or inv.revoked_at is not null or inv.expires_at <= now() then
    raise exception 'This invitation is not valid' using errcode = '42501';
  end if;
  select lower(github_username) into v_login from public.profiles where id = v_uid;
  if v_login is distinct from inv.invitee_login then
    raise exception 'This invitation is for another account' using errcode = '42501';
  end if;
  -- The inviter must still be the course's owner (and not banned): an
  -- invitation from a former owner or a banned account is void (G1 F2).
  if not exists (
    select 1 from public.course_members m join auth.users u on u.id = m.user_id
     where m.package_id = inv.package_id and m.user_id = inv.invited_by and m.role = 'owner'
       and (u.banned_until is null or u.banned_until <= now())
  ) then
    raise exception 'This invitation is no longer valid' using errcode = '42501';
  end if;
  insert into public.course_members (package_id, user_id, role, added_by)
  values (inv.package_id, v_uid, 'co-author', inv.invited_by)
  on conflict (package_id, user_id) do nothing;
  update public.course_invitations set accepted_by = v_uid, accepted_at = now() where id = inv.id;
  -- Other open invitations for the same person to this course are spent too (G1 F1).
  update public.course_invitations set revoked_at = now()
   where package_id = inv.package_id and invitee_login = inv.invitee_login
     and accepted_by is null and revoked_at is null and id <> inv.id;
  return inv.package_id;
end $$;

create function public.revoke_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pkg text;
begin
  select package_id into v_pkg from public.course_invitations where id = p_id;
  if v_pkg is null or public.course_role(v_pkg) is distinct from 'owner' then
    raise exception 'Only the owner can revoke an invitation' using errcode = '42501';
  end if;
  update public.course_invitations set revoked_at = now() where id = p_id and accepted_by is null;
end $$;

-- ---------------------------------------------------------------------------
-- Membership changes
-- ---------------------------------------------------------------------------
create function public.remove_member(p text, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.course_role(p) is distinct from 'owner' then
    raise exception 'Only the owner can remove a member' using errcode = '42501';
  end if;
  delete from public.course_members where package_id = p and user_id = p_user and role = 'co-author';
  -- No open invitation lets a removed person back in (G1 F1).
  update public.course_invitations set revoked_at = now()
   where package_id = p and accepted_by is null and revoked_at is null
     and invitee_login = (select lower(github_username) from public.profiles where id = p_user);
end $$;

create function public.leave_course(p text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.course_role(p) not in ('co-author', 'deputy') then
    raise exception 'The owner cannot leave; transfer the course first' using errcode = '42501';
  end if;
  delete from public.course_members where package_id = p and user_id = (select auth.uid()) and role = 'co-author';
end $$;

create function public.name_deputy(p text, p_user uuid, p_until timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.course_role(p) is distinct from 'owner' then
    raise exception 'Only the owner can name a deputy' using errcode = '42501';
  end if;
  if p_until <= now() or p_until > now() + interval '6 months' then
    raise exception 'A deputy is named for up to 6 months' using errcode = '22023';
  end if;
  update public.course_members set deputy_until = p_until
  where package_id = p and user_id = p_user and role = 'co-author';
  if not found then
    raise exception 'Only a co-author can be named deputy' using errcode = '22023';
  end if;
end $$;

create function public.end_deputy(p text, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.course_role(p) is distinct from 'owner' then
    raise exception 'Only the owner can end a deputy' using errcode = '42501';
  end if;
  update public.course_members set deputy_until = null where package_id = p and user_id = p_user;
end $$;

-- transfer_owner: one transaction; the old owner stays as a co-author; the
-- denormalised owner_id copies follow (packages, portal_registrations), so
-- listing consent and suggestion resolution keep working.
create function public.transfer_owner(p text, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old uuid := (select auth.uid());
begin
  if public.course_role(p) is distinct from 'owner' then
    raise exception 'Only the owner can transfer the course' using errcode = '42501';
  end if;
  -- Lock both member rows so a concurrent leave/remove can't leave the course ownerless.
  perform 1 from public.course_members where package_id = p and user_id in (v_old, p_user) for update;
  if not exists (select 1 from public.course_members where package_id = p and user_id = p_user and role = 'co-author') then
    raise exception 'The new owner must be a co-author of the course' using errcode = '22023';
  end if;
  update public.course_members set role = 'co-author', deputy_until = null where package_id = p and user_id = v_old;
  update public.course_members set role = 'owner', deputy_until = null where package_id = p and user_id = p_user and role = 'co-author';
  if not found then
    raise exception 'The new owner left the course' using errcode = '40001';
  end if;
  -- Invitations the previous owner sent are void (G1 F2). The owner_id copies
  -- follow through the owner-sync trigger below.
  update public.course_invitations set revoked_at = now()
   where package_id = p and accepted_by is null and revoked_at is null;
end $$;

-- Owner sync: course_members is the source of truth; the denormalised
-- owner_id copies (packages, portal_registrations) follow ANY ownership
-- change, not only transfer_owner (spec §2; G1 F4).
create function public.course_members_owner_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'owner' then
    update public.packages set owner_id = new.user_id where id = new.package_id and owner_id is distinct from new.user_id;
    update public.portal_registrations set owner_id = new.user_id where package_id = new.package_id and owner_id is distinct from new.user_id;
  end if;
  return new;
end $$;
revoke execute on function public.course_members_owner_sync() from public, anon, authenticated;
create trigger course_members_owner_sync
  after insert or update of role on public.course_members
  for each row execute function public.course_members_owner_sync();

-- Every membership definer: never callable by anon or PUBLIC.
revoke execute on function public.invite_member(text, text, text, int) from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
revoke execute on function public.revoke_invitation(uuid) from public, anon;
revoke execute on function public.remove_member(text, uuid) from public, anon;
revoke execute on function public.leave_course(text) from public, anon;
revoke execute on function public.name_deputy(text, uuid, timestamptz) from public, anon;
revoke execute on function public.end_deputy(text, uuid) from public, anon;
revoke execute on function public.transfer_owner(text, uuid) from public, anon;
grant execute on function public.invite_member(text, text, text, int) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.remove_member(text, uuid) to authenticated;
grant execute on function public.leave_course(text) to authenticated;
grant execute on function public.name_deputy(text, uuid, timestamptz) to authenticated;
grant execute on function public.end_deputy(text, uuid) to authenticated;
grant execute on function public.transfer_owner(text, uuid) to authenticated;
