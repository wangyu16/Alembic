-- Security loop r2 (round-2 audit, 2026-10-23), findings NEW-5 and LOW-1: a
-- course listing is written by the server, and the public reads only listable
-- ones. NOT APPLIED anywhere yet. Requires 0025_loop_r1_1 (the policies and
-- column grants it narrows) and 0028_loop_r2_1 (registered_at trigger).
--
-- THE HOLES.
--   NEW-5 (P5.S.1.f). "List publicly" is a Tier-3 action with gates the
--     server checks (published, open licence, the educator's copyright
--     attestation, release gates — registerPackageAction), but the row it
--     writes was an ordinary owner insert: the owner could write it straight
--     through the API and skip every gate, and rewrite its snapshot columns
--     (title, licence, URLs) at will afterwards.
--   LOW-1 (P5.S.1.g). Its "public read" policy was `using (true)`: a row for a
--     trial or archived course (a stray or a direct write) exposed that
--     course's title and description to anyone.
--
-- THE FIX.
--   1. INSERT and UPDATE are revoked from anon and authenticated (and their
--      policies dropped). Listing goes through registerPackageAction, which
--      checks every gate and then writes with the service client, scoped to
--      the owner (lib/package-trust-writes.ts, recordListing). Unlisting stays
--      an owner DELETE ("owner delete" is kept).
--   2. The public read policy becomes: the course is listable
--      (discovery_course_listable — published, not archived, recorded repo,
--      owner's consent row), or the caller owns the package (the workspace
--      shows the owner their own listing state).
--
-- READ-ONLY PRE-CHECK (rows that become owner-only to read):
--   select r.package_id, p.storage, p.archived_at from public.portal_registrations r
--   join public.packages p on p.id = r.package_id
--   where not public.discovery_course_listable(r.package_id);
--
-- DEPLOY ORDER: CODE FIRST. The r2 registerPackageAction writes the row with
-- the service client (SUPABASE_SECRET_KEY, already required for publishing);
-- the pre-r2 code's session upsert is refused once this file is applied.
-- Nothing public reads unlisted rows: Discover reads discovery_courses, and
-- the workspace reads the owner's own row. Apply after 0028_loop_r2_3.

-- ---------------------------------------------------------------------------
-- 1. Writes: the server inserts and updates; the owner may still delete.
-- ---------------------------------------------------------------------------
drop policy if exists "owner insert" on public.portal_registrations;
drop policy if exists "owner update" on public.portal_registrations;
revoke insert, update on public.portal_registrations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reads: listable courses for everyone, the owner's own row for the owner.
-- ---------------------------------------------------------------------------
drop policy if exists "public read" on public.portal_registrations;
create policy "public reads listable courses" on public.portal_registrations
  for select using (
    public.discovery_course_listable(package_id)
    or public.caller_owns_package(package_id)
  );

comment on table public.portal_registrations is
  'The owner''s "List publicly" consent + listing snapshot. Written only by the server (registerPackageAction → service client, after its gates; 0028_loop_r2_4); the owner may delete it. Readable when the course is listable, or by its owner.';
