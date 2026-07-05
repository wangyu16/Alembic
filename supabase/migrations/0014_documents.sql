-- documents: the registration registry (contract v2 §3 — the R2 durable core).
--
-- Every file in a package is REGISTERED here, identically whichever door it
-- came through (created in workspace / uploaded / committed directly to
-- GitHub — origin parity). This table is a REBUILDABLE PROJECTION of repo
-- content: a full re-scan of a package's repos reproduces every row, and the
-- repositories always win on disagreement. It is a cache, not the source of
-- truth. A deleted file's row is TOMBSTONED (retained forever); its doc_id is
-- never reused.

create table public.documents (
  -- Minted at first registration; immutable; survives rename/move/transfer.
  doc_id text primary key,
  package_id text not null references public.packages (id) on delete cascade,
  repo text not null check (repo in ('public', 'private')),
  -- Current location; path updates on rename/move, doc_id never.
  path text not null,
  -- Contract-v2 space (the space IS the layer). Free text: the pure contract
  -- (packages/package-contract spaces.ts) owns the enum; the DB stays a
  -- projection and does not duplicate it.
  space text not null,
  -- Carrier kind id from the kind registry ("md", "slides", "png", …).
  kind text not null,
  format_version int not null default 0,
  -- Hash of the extracted source (carrier formats) or file bytes.
  source_hash text,
  origin text not null check (origin in ('created', 'uploaded', 'external-commit')),
  author uuid references public.profiles (id),
  registered_at timestamptz not null default now(),
  -- Per-file; defaults to the package license (resolved in app code).
  license text,
  -- For objects (a11y + element search); may be captured lazily.
  description text,
  alt_text text,
  -- Opt-in per file via "share this"; private/current can never be true.
  discoverable boolean not null default false,
  permalink_class text not null check (permalink_class in ('document', 'object')),
  -- True after deletion; the doc_id is never reused.
  tombstoned boolean not null default false,
  -- Optional file-level lineage: the source doc_id when copied from another
  -- package.
  adapted_from text
);

-- Identity at a location: at most one live (non-tombstoned) row per
-- (package, repo, path). Tombstoned rows are excluded so a path can be
-- re-registered after deletion without colliding with the old tombstone.
create unique index documents_location_idx
  on public.documents (package_id, repo, path)
  where not tombstoned;

-- Discover / element search reads discoverable files by package.
create index documents_discoverable_idx
  on public.documents (package_id, discoverable)
  where discoverable;

alter table public.documents enable row level security;

-- Owner-only: a document belongs to a package the user owns. No public read in
-- MVP (Discover reads a public-safe view later). Mirrors the per-package RLS
-- style of sandbox_files (join packages on owner_id = auth.uid()).
create policy "owner reads documents" on public.documents
  for select using (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
  );

create policy "owner inserts documents" on public.documents
  for insert with check (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
  );

create policy "owner updates documents" on public.documents
  for update using (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
  )
  with check (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
  );
