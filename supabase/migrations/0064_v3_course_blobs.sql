-- 0064: the ledger of uploaded files (package-contract-v3 §11.2-§11.3; G0 r2 H1, M4).
--
-- A non-text file reaches a course only through the upload route: it checks
-- the person's right, the size, the quota and the bytes, creates the GitHub
-- blob, records it here, and only then queues a reference to it. The
-- committer accepts a blob reference only if this course's ledger has that
-- blob with the matching kind, so a member can't skip the checks by queuing
-- a sha directly. The bytes never enter the database. Quota and rate limits
-- count from here (every blob created, committed or not).
--
-- Server only: no grants to anon or authenticated.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0063; before the web app's
-- upload route and the worker that checks the ledger.

create table public.course_blobs (
  package_id   text not null references public.packages (id) on delete cascade,
  sha          text not null check (sha ~ '^[0-9a-f]{40}$'),
  size         bigint not null check (size >= 0),
  kind         text not null check (kind in ('png', 'jpeg', 'gif', 'webp', 'svg')),
  path         text not null check (length(path) <= 1024),
  uploaded_by  uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  committed_at timestamptz,
  primary key (package_id, sha, path)
);
create index course_blobs_by_uploader on public.course_blobs (uploaded_by, created_at);
create index course_blobs_by_course on public.course_blobs (package_id, created_at);

alter table public.course_blobs enable row level security;
revoke all on public.course_blobs from anon, authenticated;
