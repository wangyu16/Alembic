-- CF4.1 — per-file discovery tags for the documents registry.
-- See docs/specs/collections-framework.md §4 (Assets metadata: description +
-- tags + license). Additive: `documents` already carries description + license;
-- tags did not exist per file (keywords lived only on portal_registrations, at
-- whole-package level). This adds them so a shared asset can be found by tag in
-- Discover's element search.
alter table public.documents
  add column if not exists tags text[] not null default '{}';

-- A GIN index so an element search can filter by tag without a table scan.
create index if not exists documents_tags_idx on public.documents using gin (tags);

comment on column public.documents.tags is
  'Per-file discovery tags (collections framework, CF4). Distinct from the whole-package manifest.keywords / portal_registrations.keywords.';
