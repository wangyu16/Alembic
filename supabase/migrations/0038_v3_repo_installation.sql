-- 0038: which GitHub App installation owns a course's repositories
-- (workspace v3, permissions §4.4, queue-and-jobs §6).
--
-- clientForCourse uses this installation for every GitHub call about the
-- course, whoever acts (owner, co-author, agent, worker), with tokens scoped
-- to the course's two repositories. Kept in its own table, not a packages
-- column: members can read their course's packages row (0036), and this id is
-- platform state, service-role only (G1 F3).
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any.

create table public.course_installations (
  package_id      text primary key references public.packages (id) on delete cascade,
  installation_id bigint not null,
  recorded_at     timestamptz not null default now()
);
alter table public.course_installations enable row level security;
revoke all on public.course_installations from anon, authenticated;

comment on table public.course_installations is
  'GitHub App installation on the account that owns the course repositories (v3). Set at course creation and when a transfer completes; service-role only.';
