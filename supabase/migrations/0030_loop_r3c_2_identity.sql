-- Security loop r3 (round-3 audit, 2026-10-24), finding HIGH-1
-- (P5.B.1.q, P5.S.15, P5.S.16): an identity column never changes after
-- insert, for any role. NOT APPLIED anywhere yet. Requires 0028_loop_r2_2
-- (the retired-id ledger this closes the last door around). Independent of
-- 0030_loop_r3c_1 (whose parking step changes path only).
--
-- THE HOLE. 0028_loop_r2_2 refuses a RETIRED docId on INSERT only, and
-- documents has no column grants (the owner may UPDATE every column of its
-- own rows). So an owner could take ANY id by renaming one of its own rows:
--   update documents set doc_id = 'doc-cited00001', source_hash = 'oldhash'
--   where doc_id = 'doc-mine…';
-- reclaiming a retired id — every citation and pin /d/{id}@{hash} of the
-- deleted course then served the newcomer's bytes — or a back-filled lineage
-- target, which then counted toward an adaptation_count (repros
-- /tmp/alembic-r3/r3db.test.ts H1, r3b.test.ts "H1 variant"). Renaming a row
-- away also freed its old id without retiring it.
--
-- THE FIX. One generic BEFORE UPDATE trigger function,
-- public.refuse_identity_change(columns…), installed on every table whose
-- primary-key / foreign-key identity columns the API roles can update, with
-- the columns it guards as trigger arguments. It refuses (check_violation) any
-- UPDATE that changes one of them — for every role, the platform's own
-- service paths included (no Alembic code renames an id; a docId is minted
-- once and survives rename/move/transfer by changing path, never doc_id).
--   documents            doc_id           (package_id: 0027's trigger, kept —
--                                          its message maps to ForeignDocIdError)
--   packages             id
--   portal_registrations package_id
--   suggestions          target_package_id, from_package_id, from_user_id
--   sandbox_files        package_id
--   package_changes      package_id, user_id (its policy checks only user_id)
-- (A GENERATED ALWAYS identity — suggestions.id, package_changes.id — cannot
-- be updated to a value at all.)
-- Owner columns (packages.owner_id, portal_registrations.owner_id) are NOT
-- frozen: ownership is a role, not an identity, and is guarded by RLS and the
-- re-own refresh (0025_loop_r1_2).
--
-- READ-ONLY PRE-CHECK: none needed (no data changes; refuses future renames).
--
-- DEPLOY ORDER: either order with the r3c code (no code renames an id).

create or replace function public.refuse_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_col text;
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
begin
  foreach v_col in array tg_argv loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) then
      raise exception '%.% is permanent: % never changes once issued',
        tg_table_name, v_col, coalesce(v_old ->> v_col, 'this id')
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.refuse_identity_change() from public, anon, authenticated;

drop trigger if exists documents_identity_immutable on public.documents;
create trigger documents_identity_immutable
  before update on public.documents
  for each row execute function public.refuse_identity_change('doc_id');

drop trigger if exists packages_identity_immutable on public.packages;
create trigger packages_identity_immutable
  before update on public.packages
  for each row execute function public.refuse_identity_change('id');

drop trigger if exists portal_registrations_identity_immutable on public.portal_registrations;
create trigger portal_registrations_identity_immutable
  before update on public.portal_registrations
  for each row execute function public.refuse_identity_change('package_id');

drop trigger if exists suggestions_identity_immutable on public.suggestions;
create trigger suggestions_identity_immutable
  before update on public.suggestions
  for each row execute function public.refuse_identity_change('target_package_id', 'from_package_id', 'from_user_id');

drop trigger if exists sandbox_files_identity_immutable on public.sandbox_files;
create trigger sandbox_files_identity_immutable
  before update on public.sandbox_files
  for each row execute function public.refuse_identity_change('package_id');

drop trigger if exists package_changes_identity_immutable on public.package_changes;
create trigger package_changes_identity_immutable
  before update on public.package_changes
  for each row execute function public.refuse_identity_change('package_id', 'user_id');
