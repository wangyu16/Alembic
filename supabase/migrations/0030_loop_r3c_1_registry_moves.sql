-- Correctness loop r3 (round-3 audit, 2026-10-24), finding H3-1
-- (P5.B.1.x): a registration run may move identities along a shift, a swap
-- or a cycle of paths in ONE call. NOT APPLIED anywhere yet. Requires 0029
-- (documents_apply, redefined here) and 0028_loop_r2_1 / _2 (triggers,
-- unchanged). Apply after 0029_loop_r2c_3.
--
-- COMPOSITION. documents_apply's latest definition is 0029_loop_r2c_2's;
-- this keeps ALL of it: SECURITY INVOKER (the caller's RLS applies), one
-- package per call (every row must name p_package_id), the deferral (one
-- discovery refresh per run), tombstones before upserts in ONE transaction,
-- package_id in the update so 0027's trigger refuses a cross-package move,
-- and r2c's owner-set rules (discoverable / description / tags / alt_text /
-- registered_at kept on a LIVE row; license / adapted_from fill only a missing
-- value; a resurrected tombstoned row takes the run's values). The r2 rules
-- stay in force through their triggers: registered_at server-owned (0028_1),
-- a retired id refused on insert (0028_2), and doc_id immutable
-- (0030_loop_r3c_2 — the move below changes PATH only, never doc_id).
-- loop-r3c.sql.test.ts extends the composition test (P5.A.1.r).
--
-- THE HOLE. The registry's upsert updates rows one at a time, and the
-- location index (documents_location_idx: one live row per package + repo +
-- path) is checked per row and cannot be deferred (a partial unique INDEX,
-- not a constraint). A run that moves X from ch2 to ch3 while Y moves from
-- ch3 to ch4 — renumbered chapters, two files swapped by an outside rename,
-- a rotation — collides with the row it is about to move, so the whole call
-- was refused (the app then split it down to single rows, which collide the
-- same way: the identities never moved; repro /tmp/p5r3/swap.mts).
--
-- THE FIX. Before the upsert, every LIVE row of this package that the call
-- moves to a different (repo, path) is first parked at a private temporary
-- path ('.alembic-moving/' || doc_id — unique because doc_id is, and not a
-- path any file can have: no space starts with a dot). The upsert then sets
-- every final path. All in the one statement/transaction: a refused row
-- rolls the parking back too. Nothing else about the row changes in the
-- parking step (source_hash unchanged → content_changed_at kept; discovery
-- refreshes are deferred to the end of the call, so the temporary path is
-- never projected).
--
-- READ-ONLY PRE-CHECK (expect 0 — no stored path uses the parking prefix):
--   select count(*) from public.documents where path like '.alembic-moving/%';
--
-- DEPLOY ORDER: either order with the r3c code (same signature). The r3c
-- registry sends a whole move chain in one call (P5.B.1.x); old code never
-- sends a chain, so for it nothing changes.

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
    -- r3c (H3-1): park every live row this call moves, so a shift, swap or
    -- cycle of paths never collides with a row that is itself moving.
    update public.documents d
    set path = '.alembic-moving/' || d.doc_id
    from jsonb_to_recordset(p_rows) as m (doc_id text, repo text, path text)
    where d.doc_id = m.doc_id
      and d.package_id = p_package_id
      and not d.tombstoned
      and (d.repo, d.path) is distinct from (m.repo, m.path);

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
