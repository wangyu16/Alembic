-- 0047: What the People page needs about invitations (workspace v3, E1).
--
-- course_open_invitations: the owner's own list (login, expiry); the token
--   hash never leaves the database.
-- invitee_address: service role only. If the invited GitHub account already
--   uses Alembic, its email address, so the invitation can also be emailed.
--   Otherwise the owner shares the link themselves.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0046.

create function public.course_open_invitations(p text)
returns table (id uuid, invitee_login text, expires_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.course_role(p) is distinct from 'owner' then
    raise exception 'Only the owner sees invitations' using errcode = '42501';
  end if;
  return query
    select i.id, i.invitee_login, i.expires_at, i.created_at
      from public.course_invitations i
     where i.package_id = p and i.accepted_by is null and i.revoked_at is null and i.expires_at > now()
     order by i.created_at desc;
end $$;
revoke execute on function public.course_open_invitations(text) from public, anon;
grant execute on function public.course_open_invitations(text) to authenticated;

create function public.invitee_address(p_invitation uuid)
returns text language sql stable security definer set search_path = '' as $$
  select u.email::text
    from public.course_invitations i
    join public.profiles pr on lower(pr.github_username) = i.invitee_login
    join auth.users u on u.id = pr.id
   where i.id = p_invitation and u.email is not null and u.email <> ''
   limit 1
$$;
revoke execute on function public.invitee_address(uuid) from public, anon, authenticated;
grant execute on function public.invitee_address(uuid) to service_role;
