-- Security loop r3 (round-3 audit, 2026-10-24), findings LOW-3 (P5.S.3.h),
-- LOW-4 (P5.S.3.i) and LOW-5 (P5.S.1.h): the listing's accessibility and
-- recency signals are the server's. NOT APPLIED anywhere yet. Requires
-- 0025_loop_r1_2 (packages.a11y_status), 0028_loop_r2_1 (registered_at
-- trigger, kept) and 0028_loop_r2_4 (registrations written by the server).
-- Apply after 0030_loop_r3c_3.
--
-- COMPOSITION. No existing function is redefined: server_owned_registered_at
-- (0028_loop_r2_1) still sets now() on insert / keeps the old value on update;
-- the new BEFORE INSERT trigger below runs AFTER it (trigger names fire in
-- order: portal_registrations_registered_at < …_registered_at_first) and only
-- moves registered_at back to the course's first listing. The projector
-- (0029_loop_r2c_1) is unchanged: it reads packages.a11y_status, which the
-- trigger in §2 resets.
--
-- THE HOLES.
--   LOW-3. registerPackageAction copied the OWNER-WRITABLE manifest field
--     accessibility.status into portal_registrations.accessibility_status,
--     which anon can read — a course could advertise "pass" it never earned.
--   LOW-4. packages.a11y_status said nothing about WHICH bytes were checked:
--     a "pass" survived every later save.
--   LOW-5. Unlisting deletes the registration row; listing again inserted a
--     new one with registered_at = now(), so an owner could refresh "newly
--     listed" recency at will by unlisting and re-listing.
--
-- THE FIX.
--   1. portal_registrations.accessibility_status is server-owned: a BEFORE
--      INSERT OR UPDATE trigger sets it from packages.a11y_status (any value a
--      writer sends is ignored), and a change of packages.a11y_status is
--      carried into the listing row.
--   2. packages.a11y_checked_sha (service role only, like a11y_status): the
--      public head the check audited. When the recorded public head
--      (packages.last_synced_sha) moves to anything else, a BEFORE UPDATE
--      trigger resets a11y_status to 'unknown' ("not checked") — the
--      projection follows (course row). Rows checked before this migration are
--      taken as checked at their current head (back-fill), so nothing flips at
--      deploy. A check that records a status sets both columns together.
--   3. public.listing_history — a private ledger of each package's FIRST
--      listing (no API access). A re-listing keeps registered_at at the first
--      listing; the first listing records it.
--
-- READ-ONLY PRE-CHECKS:
--   -- listing rows whose advertised status differs from the server record (§1 corrects them):
--   select count(*) from public.portal_registrations r join public.packages p on p.id = r.package_id
--   where r.accessibility_status is distinct from p.a11y_status;
--   -- checked packages that get a back-filled checked sha (§2):
--   select count(*) from public.packages where a11y_checked_at is not null;
--
-- DEPLOY ORDER: either order with the r3c code (code first is cleaner: the
-- r3c accessibility check also records a11y_checked_sha; old code's check
-- leaves it null, which §2 treats as "checked at the head of the moment").

-- ---------------------------------------------------------------------------
-- 1. The listing's accessibility status is the server record (LOW-3).
-- ---------------------------------------------------------------------------
create or replace function public.registration_a11y_from_package()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.accessibility_status := coalesce(
    (select p.a11y_status from public.packages p where p.id = new.package_id), 'unknown');
  return new;
end;
$$;

drop trigger if exists portal_registrations_a11y on public.portal_registrations;
create trigger portal_registrations_a11y
  before insert or update on public.portal_registrations
  for each row execute function public.registration_a11y_from_package();

create or replace function public.packages_a11y_to_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.portal_registrations r
  set accessibility_status = new.a11y_status -- (re-derived by the trigger above)
  where r.package_id = new.id
    and r.accessibility_status is distinct from new.a11y_status;
  return null;
end;
$$;

drop trigger if exists packages_a11y_to_registration on public.packages;
create trigger packages_a11y_to_registration
  after update of a11y_status on public.packages
  for each row
  when (new.a11y_status is distinct from old.a11y_status)
  execute function public.packages_a11y_to_registration();

-- correct what is stored
update public.portal_registrations r
set accessibility_status = p.a11y_status
from public.packages p
where p.id = r.package_id
  and r.accessibility_status is distinct from p.a11y_status;

-- ---------------------------------------------------------------------------
-- 2. A check describes the bytes it audited (LOW-4).
-- ---------------------------------------------------------------------------
alter table public.packages add column if not exists a11y_checked_sha text;
comment on column public.packages.a11y_checked_sha is
  'The public head the accessibility check audited (0030_loop_r3c_4). Service role only. When last_synced_sha moves elsewhere, a11y_status resets to unknown.';

alter table public.packages disable trigger packages_listing_changed_at;
update public.packages
set a11y_checked_sha = last_synced_sha
where a11y_checked_at is not null and a11y_checked_sha is null;
alter table public.packages enable trigger packages_listing_changed_at;

create or replace function public.packages_a11y_expires()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- the recorded head moved past the audited bytes, and this same update is
  -- not itself recording a check
  if new.last_synced_sha is distinct from old.last_synced_sha
     and new.a11y_checked_sha is not distinct from old.a11y_checked_sha
     and new.a11y_status is not distinct from old.a11y_status
     and new.a11y_status <> 'unknown'
     and new.last_synced_sha is distinct from new.a11y_checked_sha then
    new.a11y_status := 'unknown';
  end if;
  return new;
end;
$$;

drop trigger if exists packages_a11y_expires on public.packages;
create trigger packages_a11y_expires
  before update on public.packages
  for each row execute function public.packages_a11y_expires();

-- ---------------------------------------------------------------------------
-- 3. Recency survives unlisting (LOW-5).
-- ---------------------------------------------------------------------------
create table if not exists public.listing_history (
  package_id text primary key,
  first_listed_at timestamptz not null default now()
);
alter table public.listing_history enable row level security;
-- No policies and no API privileges: only the trigger below touches it.
revoke all on public.listing_history from public, anon, authenticated, service_role;

comment on table public.listing_history is
  'Each package''s first public listing (0030_loop_r3c_4). Private; keeps registered_at across unlist/re-list.';

insert into public.listing_history (package_id, first_listed_at)
select package_id, registered_at from public.portal_registrations
on conflict (package_id) do update
  set first_listed_at = least(public.listing_history.first_listed_at, excluded.first_listed_at);

create or replace function public.registration_first_listed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first timestamptz;
begin
  insert into public.listing_history (package_id, first_listed_at)
  values (new.package_id, new.registered_at)
  on conflict (package_id) do nothing;
  select h.first_listed_at into v_first from public.listing_history h where h.package_id = new.package_id;
  new.registered_at := least(coalesce(v_first, new.registered_at), new.registered_at);
  return new;
end;
$$;

-- (fires after portal_registrations_registered_at, which set now())
drop trigger if exists portal_registrations_registered_at_first on public.portal_registrations;
create trigger portal_registrations_registered_at_first
  before insert on public.portal_registrations
  for each row execute function public.registration_first_listed();

revoke all on function public.registration_a11y_from_package() from public, anon, authenticated;
revoke all on function public.packages_a11y_to_registration() from public, anon, authenticated;
revoke all on function public.packages_a11y_expires() from public, anon, authenticated;
revoke all on function public.registration_first_listed() from public, anon, authenticated;
