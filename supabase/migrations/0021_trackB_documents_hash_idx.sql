-- Track B.1 (Phase 5): the one registry index a query actually needs.
--
-- `getByContentHash` (adaptation's "already have this exact object here?"
-- check, and single-file `registerFile`) filters live rows of one package by
-- source hash. Without this it scans every row of the package, tombstones
-- included — and tombstones are kept forever.
--
-- Not added, on purpose:
--   * adapted_from — no query filters on it today (lineage is read per row).
--     Add it with the first query that does (Track A lineage counts).
--   * a live-rows-by-package index — `documents_location_idx`
--     (package_id, repo, path) WHERE NOT tombstoned already serves
--     `listLiveByPackage` exactly, ordering included.
--
-- Additive and safe to apply at any time; nothing depends on it for
-- correctness.
create index if not exists documents_hash_idx
  on public.documents (package_id, source_hash)
  where not tombstoned;
