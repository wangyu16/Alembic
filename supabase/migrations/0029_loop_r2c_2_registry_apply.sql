-- Correctness loop r2 (round-2 audit, 2026-10-23), finding MEDIUM-1
-- (P5.B.1.t): a registration run never overwrites what the owner set.
-- NOT APPLIED anywhere yet. Requires 0027 (documents_apply, redefined here)
-- and 0028_loop_r2_1 / _2 (whose triggers it relies on, unchanged).
--
-- COMPOSITION. documents_apply's latest definition is 0027's (0028_* changed
-- the table's triggers, not the function); this keeps all of it: SECURITY
-- INVOKER (the caller's RLS applies), one package per call, the deferral
-- (one discovery refresh per run), tombstones before upserts in ONE
-- transaction, and package_id in the update so 0027's trigger refuses a
-- cross-package move. The r2 rules stay in force through their triggers:
-- registered_at is server-owned (0028_1: now() on insert, the old value on
-- update) and a retired id is refused on insert (0028_2).
--
-- THE HOLE. The upsert's `on conflict (doc_id) do update` set every column
-- from the run's rows, and a run builds its rows from the live registry it
-- READ at its start. An owner action committed in between — "Share this"
-- (discoverable), a description, tags, alt text or licence (setAssetMetadata)
-- — was overwritten with the stale values (repro /tmp/p5r2/sharerace.mts:
-- the figure the owner had just shared went back to not shared, its
-- description gone).
--
-- THE FIX. On conflict with a LIVE row, the owner-set columns keep the
-- stored value: discoverable, description, tags, alt_text and registered_at
-- as stored; license and adapted_from keep the stored value and only fill a
-- missing one (lineage is set once). Only when the run RESURRECTS a
-- tombstoned row (a deleted document uploaded again) does the row take the
-- run's values, as a new registration would.
--
-- READ-ONLY PRE-CHECK: none needed (no data changes).
--
-- DEPLOY ORDER: either order with the r2c code (same signature; the app's
-- registration already preserves these fields from what it read — this makes
-- the database keep them against a concurrent owner write). The r2c code
-- writes at most 500 rows per call (P5.B.1.u). Apply after 0029_loop_r2c_1.

create or replace function public.documents_apply(
  p_package_id text,
  p_tombstones text[],
  p_rows jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_package_id is null then
    raise exception 'documents_apply: package id required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where r ->> 'package_id' is distinct from p_package_id
  ) then
    raise exception 'documents_apply: every row must belong to package %', p_package_id;
  end if;

  perform public.discovery_defer_begin();

  if coalesce(cardinality(p_tombstones), 0) > 0 then
    update public.documents
    set tombstoned = true
    where package_id = p_package_id
      and doc_id = any (p_tombstones)
      and not tombstoned;
  end if;

  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 0 then
    insert into public.documents as d (
      doc_id, package_id, repo, path, space, kind, format_version, source_hash,
      origin, author, registered_at, license, description, tags, alt_text,
      discoverable, permalink_class, tombstoned, adapted_from, content_sha256
    )
    select
      x.doc_id, x.package_id, x.repo, x.path, x.space, x.kind,
      coalesce(x.format_version, 0), x.source_hash, x.origin, x.author,
      -- (server-owned since 0028_loop_r2_1: the trigger sets now())
      coalesce(x.registered_at, now()), x.license, x.description,
      coalesce(x.tags, '{}'), x.alt_text, coalesce(x.discoverable, false),
      x.permalink_class, coalesce(x.tombstoned, false), x.adapted_from,
      x.content_sha256
    from jsonb_to_recordset(p_rows) as x (
      doc_id text, package_id text, repo text, path text, space text,
      kind text, format_version integer, source_hash text, origin text,
      author uuid, registered_at timestamptz, license text, description text,
      tags text[], alt_text text, discoverable boolean, permalink_class text,
      tombstoned boolean, adapted_from text, content_sha256 text
    )
    on conflict (doc_id) do update set
      -- package_id deliberately included: 0027's trigger refuses a change.
      package_id = excluded.package_id,
      repo = excluded.repo,
      path = excluded.path,
      space = excluded.space,
      kind = excluded.kind,
      format_version = excluded.format_version,
      source_hash = excluded.source_hash,
      origin = excluded.origin,
      author = excluded.author,
      -- r2c (MEDIUM-1): what the OWNER set is kept unless this run resurrects
      -- a tombstoned row (then the run's values, as a new registration).
      registered_at = d.registered_at,
      license = case when d.tombstoned then excluded.license
                     else coalesce(d.license, excluded.license) end,
      description = case when d.tombstoned then excluded.description else d.description end,
      tags = case when d.tombstoned then excluded.tags else d.tags end,
      alt_text = case when d.tombstoned then excluded.alt_text else d.alt_text end,
      discoverable = case when d.tombstoned then excluded.discoverable else d.discoverable end,
      permalink_class = excluded.permalink_class,
      tombstoned = excluded.tombstoned,
      adapted_from = case when d.tombstoned then excluded.adapted_from
                          else coalesce(d.adapted_from, excluded.adapted_from) end,
      content_sha256 = excluded.content_sha256;
  end if;

  perform public.discovery_defer_end();
end;
$$;

revoke all on function public.documents_apply(text, text[], jsonb) from public, anon;
grant execute on function public.documents_apply(text, text[], jsonb) to authenticated, service_role;
