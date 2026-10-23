-- Security loop r2 (round-2 audit, 2026-10-23), findings NEW-3 and LOW-2:
-- a docId and a packageId are never reused, even after deletion; the
-- "is this id taken?" question answers only for the caller's own package.
-- NOT APPLIED anywhere yet. Requires 0027 (documents_foreign_doc_ids).
--
-- THE HOLES.
--   NEW-3 (P5.B.1.q). Documents are tombstoned, never deleted — but deleting
--     a PACKAGE row (the owner's REST delete, or reconcileArchivedPackages
--     purging an archived course whose repository is gone) cascades to its
--     documents, and then nothing remembered the ids. Another educator could
--     re-register the freed docId (documents_apply / a direct insert) with the
--     old pin hash: every citation and include of /d/{docId}@{hash} then
--     served the newcomer's bytes (repro /tmp/alembic-r2/probe2.mts). The same
--     for a package id: re-creating a freed id inherited the old course's
--     adaptations, its lineage links and its suggestions inbox (probe3.mts).
--   LOW-2 (P5.B.1.r). documents_foreign_doc_ids(p_package_id, ids) answered
--     for ANY p_package_id, so asking relative to someone else's package was a
--     membership oracle ("is doc X in trial package Y?").
--
-- THE FIX.
--   1. public.retired_ids — an append-only ledger of every doc and package id
--      that ever existed and was deleted (AFTER DELETE statement triggers,
--      including cascades). Private: no API role may read or write it.
--   2. Back-fill with the ids this database can still prove existed: lineage
--      targets (documents.adapted_from, manifest adaptedFrom.packageId) and
--      research events whose package row is gone.
--   3. BEFORE INSERT triggers on documents and packages refuse a retired id
--      (every role — the platform never re-issues an id either).
--   4. documents_foreign_doc_ids answers "taken" for retired ids too (so the
--      registry mints a fresh identity instead of failing), only for a package
--      the caller owns (else it refuses), and for at most 500 ids per call (the
--      app's chunk).
--
-- READ-ONLY PRE-CHECK (run first; what the back-fill will record):
--   select 'doc' as kind, count(distinct d.adapted_from) from public.documents d
--   where d.adapted_from is not null
--     and not exists (select 1 from public.documents s where s.doc_id = d.adapted_from)
--   union all
--   select 'package', count(distinct p.manifest -> 'adaptedFrom' ->> 'packageId') from public.packages p
--   where p.manifest ? 'adaptedFrom'
--     and not exists (select 1 from public.packages q where q.id = p.manifest -> 'adaptedFrom' ->> 'packageId');
--
-- DEPLOY ORDER: either order with the r2 code. The registry already asks
-- documents_foreign_doc_ids before adopting an embedded uid, and always for
-- its own package, so the new refusal never fires for the app. Apply after
-- 0028_loop_r2_1.
--
-- Residual (documented): a caller still learns whether an id it already holds
-- (e.g. from a permalink it has seen) is taken — inherent in "mint a fresh
-- identity when this uid is someone else's"; ids are ~62-bit random.

-- ---------------------------------------------------------------------------
-- 1. The ledger.
-- ---------------------------------------------------------------------------
create table if not exists public.retired_ids (
  kind text not null check (kind in ('doc', 'package')),
  id text not null,
  retired_at timestamptz not null default now(),
  primary key (kind, id)
);

alter table public.retired_ids enable row level security;
-- No policies: only the security-definer functions below touch it.
revoke all on public.retired_ids from public, anon, authenticated;
revoke insert, update, delete, truncate on public.retired_ids from service_role;

comment on table public.retired_ids is
  'Every doc_id / package id that existed and was deleted (0028_loop_r2_2). Append-only, written by delete triggers; such an id is never issued again.';

-- ---------------------------------------------------------------------------
-- 2. Back-fill what can still be proven to have existed.
-- ---------------------------------------------------------------------------
insert into public.retired_ids (kind, id)
select distinct 'doc', d.adapted_from
from public.documents d
where d.adapted_from is not null
  and not exists (select 1 from public.documents s where s.doc_id = d.adapted_from)
on conflict do nothing;

insert into public.retired_ids (kind, id)
select distinct 'package', p.manifest -> 'adaptedFrom' ->> 'packageId'
from public.packages p
where p.manifest ? 'adaptedFrom'
  and coalesce(p.manifest -> 'adaptedFrom' ->> 'packageId', '') <> ''
  and not exists (select 1 from public.packages q where q.id = p.manifest -> 'adaptedFrom' ->> 'packageId')
on conflict do nothing;

insert into public.retired_ids (kind, id)
select distinct 'package', e.package_id
from public.research_events e
where e.package_id is not null
  and not exists (select 1 from public.packages q where q.id = e.package_id)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Deletion retires; insertion of a retired id is refused.
-- ---------------------------------------------------------------------------
create or replace function public.retire_deleted_ids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'documents' then
    insert into public.retired_ids (kind, id)
    select 'doc', o.doc_id from old_rows o
    on conflict do nothing;
  else
    insert into public.retired_ids (kind, id)
    select 'package', o.id from old_rows o
    on conflict do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists documents_retire_ids on public.documents;
create trigger documents_retire_ids
  after delete on public.documents
  referencing old table as old_rows
  for each statement execute function public.retire_deleted_ids();

drop trigger if exists packages_retire_ids on public.packages;
create trigger packages_retire_ids
  after delete on public.packages
  referencing old table as old_rows
  for each statement execute function public.retire_deleted_ids();

create or replace function public.refuse_retired_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'documents' then
    if exists (select 1 from public.retired_ids r where r.kind = 'doc' and r.id = new.doc_id) then
      raise exception 'docId % was retired and is never reused', new.doc_id
        using errcode = 'check_violation';
    end if;
  elsif exists (select 1 from public.retired_ids r where r.kind = 'package' and r.id = new.id) then
    raise exception 'package id % was retired and is never reused', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists documents_refuse_retired_id on public.documents;
create trigger documents_refuse_retired_id
  before insert on public.documents
  for each row execute function public.refuse_retired_id();

drop trigger if exists packages_refuse_retired_id on public.packages;
create trigger packages_refuse_retired_id
  before insert on public.packages
  for each row execute function public.refuse_retired_id();

-- ---------------------------------------------------------------------------
-- 4. "Is this id taken?" — for the caller's own package only; retired = taken.
-- ---------------------------------------------------------------------------
create or replace function public.documents_foreign_doc_ids(
  p_package_id text,
  p_doc_ids text[]
)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.caller_owns_package(p_package_id) then
    raise exception 'documents_foreign_doc_ids: not your package'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select d.doc_id
    from public.documents d
    where d.doc_id = any (p_doc_ids[1:500])
      and d.package_id is distinct from p_package_id
    union
    select r.id
    from public.retired_ids r
    where r.kind = 'doc' and r.id = any (p_doc_ids[1:500]);
end;
$$;

revoke all on function public.retire_deleted_ids() from public, anon, authenticated;
revoke all on function public.refuse_retired_id() from public, anon, authenticated;
revoke all on function public.documents_foreign_doc_ids(text, text[]) from public, anon;
grant execute on function public.documents_foreign_doc_ids(text, text[]) to authenticated;
-- (service_role: no caller; the platform reads documents directly.)
revoke all on function public.documents_foreign_doc_ids(text, text[]) from service_role;
