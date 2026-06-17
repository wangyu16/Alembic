-- Cross-owner suggest-back (M31.2). When an educator adapts another educator's
-- PUBLIC, portal-registered package and improves a block, they can suggest the
-- change back. This is a cross-owner inbox with RLS — NO service-role bypass:
--   - insert: any signed-in user, to a portal-REGISTERED package (consent =
--     registration), recording themselves as sender;
--   - read: the upstream package owner (their inbox) + the sender (their sent);
--   - resolve (accept/reject): the upstream owner only.

create table public.suggestions (
  id bigint generated always as identity primary key,
  target_package_id text not null references public.packages (id) on delete cascade,
  from_package_id text not null references public.packages (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  -- The upstream chapter + block the suggestion edits.
  chapter_path text not null,
  source_block_id text not null,
  suggested_title text,
  suggested_body text not null,
  note text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index suggestions_target_status_idx
  on public.suggestions (target_package_id, status, created_at desc);

alter table public.suggestions enable row level security;

-- Consent = registration: a suggestion may only target a portal-registered
-- package, and the sender must be the signed-in user.
create policy "send to a registered package" on public.suggestions
  for insert with check (
    (select auth.uid()) = from_user_id
    and exists (
      select 1 from public.portal_registrations r
      where r.package_id = target_package_id
    )
  );

-- The upstream owner reads their inbox; the sender reads what they sent.
create policy "owner or sender reads" on public.suggestions
  for select using (
    (select auth.uid()) = from_user_id
    or exists (
      select 1 from public.portal_registrations r
      where r.package_id = target_package_id and r.owner_id = (select auth.uid())
    )
  );

-- Only the upstream owner may accept/reject.
create policy "owner resolves" on public.suggestions
  for update using (
    exists (
      select 1 from public.portal_registrations r
      where r.package_id = target_package_id and r.owner_id = (select auth.uid())
    )
  );
