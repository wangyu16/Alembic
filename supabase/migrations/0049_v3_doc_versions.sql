-- 0049: Document versions (workspace v3, A4; write-path-v3 §3.2 step 5).
--
-- A version is the sha256 of a document's text. Each one Alembic has shown
-- or written is recorded with a commit that holds it, so the committer can
-- read the base text a change was made from (the version rule's merge base).
-- Rebuildable from the repo history; service role only.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any (new table).

create table public.doc_versions (
  package_id  text not null references public.packages (id) on delete cascade,
  path        text not null,
  version     text not null check (version ~ '^[0-9a-f]{64}$'),
  commit_sha  text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  recorded_at timestamptz not null default now(),
  primary key (package_id, path, version)
);
alter table public.doc_versions enable row level security;
revoke all on public.doc_versions from anon, authenticated;
