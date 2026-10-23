-- Phase 5 loop r1b — READ-ONLY production checks for the registry findings.
-- Run as the service role / in the SQL editor. Nothing here writes.
--
-- HIGH-2: before r1b a carrier that carried ANOTHER package's embedded uid
-- (a whole-package fork, an element adapted verbatim, a downloaded file
-- re-uploaded into another course) registered under that uid, and because
-- documents.doc_id is the global primary key the upsert MOVED the row into
-- the copy's package (same owner; another owner's upsert was refused by RLS
-- and, before r1b, its tombstones had already landed). The source's
-- permalink then resolved into the copy, and a later page load of the source
-- moved it back (flapping).

-- Q1. Carriers whose embedded uid is registered to a DIFFERENT package.
--     Each row is either the copy (file_pkg is a fork/adapter of row_pkg) or
--     the original whose row was moved away.
with carriers as (
  select f.package_id, f.repo, f.path,
         substring(f.content from '<script[^>]*id="orz-meta"[^>]*>[^<]*"uid"\s*:\s*"(doc-[^"]+)"') as uid
  from public.sandbox_files f
  where f.path ~ '\.(md|slides|paged)\.html$'
)
select c.uid,
       c.package_id                                   as file_pkg,
       c.path                                         as file_path,
       d.package_id                                   as row_pkg,
       d.path                                         as row_path,
       d.tombstoned                                   as row_tombstoned,
       p.manifest -> 'adaptedFrom' ->> 'packageId'    as file_pkg_adapted_from,
       p.created_at                                   as file_pkg_created_at
from carriers c
join public.documents d on d.doc_id = c.uid
join public.packages p on p.id = c.package_id
where c.uid is not null
  and d.package_id <> c.package_id
order by c.uid, p.created_at;

-- Q2. Embedded uids present in carriers of two or more packages (whoever
--     holds the row now). Every uid listed here needs a decision (repair below).
with carriers as (
  select f.package_id,
         substring(f.content from '<script[^>]*id="orz-meta"[^>]*>[^<]*"uid"\s*:\s*"(doc-[^"]+)"') as uid
  from public.sandbox_files f
  where f.path ~ '\.(md|slides|paged)\.html$'
)
select uid, array_agg(distinct package_id order by package_id) as packages
from carriers
where uid is not null
group by uid
having count(distinct package_id) > 1
order by uid;

-- Q3. Live registry rows whose location holds no file in their own package
--     (a row that moved away from its bytes, or a missed tombstone).
select d.doc_id, d.package_id, d.repo, d.path, d.discoverable
from public.documents d
where not d.tombstoned
  and not exists (
    select 1 from public.sandbox_files f
    where f.package_id = d.package_id and f.repo = d.repo and f.path = d.path
  )
order by d.package_id, d.path;

-- Q4. Discovery elements whose row now belongs to another package.
select e.doc_id, e.package_id as projected_pkg, d.package_id as row_pkg
from public.discovery_elements e
join public.documents d on d.doc_id = e.doc_id
where e.package_id <> d.package_id;

-- Q5 (LOW-6). Registry ids outside THE id shape (adopted from a non-canonical
--     embedded uid before r1b; `/d` could never serve them).
select doc_id, package_id, path, tombstoned
from public.documents
where doc_id !~ '^doc-[0-9a-z]{1,64}$';

-- Q6 (HIGH-1, meaningful after 0027 + the r1b code have run for a while).
--     Live rows whose registered digest differs from the stored bytes. Rows
--     with a null digest were registered before r1b and are re-verified on
--     the package's next workspace visit.
select count(*) filter (where d.content_sha256 is null)                         as unverified_pre_r1b,
       count(*) filter (where d.content_sha256 is distinct from f.content_sha256
                         and d.content_sha256 is not null)                      as stale
from public.documents d
join public.sandbox_files f
  on f.package_id = d.package_id and f.repo = d.repo and f.path = d.path
where not d.tombstoned;

-- ---------------------------------------------------------------------------
-- REPAIR PROCEDURE for Q1/Q2 (owner-run, after 0026 + 0027 + the r1b code are
-- deployed; NOT run by the loop). Per uid listed by Q2:
--
--  1. Decide the rightful package: the one that is NOT a copy of the other
--     (the copy's manifest.adaptedFrom.packageId names the source; for an
--     adapted element, the copy's row has adapted_from set), else the
--     package created first. Its file location is (owner_pkg, owner_repo,
--     owner_path) from Q1/Q2.
--  2. If the row is already in owner_pkg at owner_path and live: nothing to
--     move — go to step 4.
--  3. Otherwise move it back in ONE transaction (the 0027 guard refuses a
--     package change, so lift it for this statement only):
--
--       begin;
--       -- Abort if another live row already holds the rightful location:
--       select doc_id from public.documents
--        where package_id = :owner_pkg and repo = :owner_repo
--          and path = :owner_path and not tombstoned and doc_id <> :uid;
--       -- (if that returns a row, decide which identity keeps the location
--       --  before continuing; tombstone the other — never delete it)
--       alter table public.documents disable trigger documents_no_cross_package_move;
--       update public.documents
--          set package_id = :owner_pkg, repo = :owner_repo, path = :owner_path,
--              tombstoned = false
--        where doc_id = :uid;
--       alter table public.documents enable trigger documents_no_cross_package_move;
--       commit;
--
--  4. Open the COPY's workspace once (or run its registry sync): with r1b
--     its carrier's uid is now foreign, so the copy registers under a fresh
--     docId; its old location row, if any, is tombstoned by the sync.
--     (Optional: re-save the copy so its embedded uid is re-minted too.)
--  5. Re-project both packages: select public.discovery_refresh_package(:pkg)
--     for each, or select public.discovery_rebuild();
--  6. Re-run Q1–Q4: all empty.
--
-- Links already handed out from the copy that point at :uid will, after the
-- repair, resolve to the ORIGINAL document (which is what that id named
-- first). That is the intended outcome; note it to the owner of the copy if
-- they shared such a link.
