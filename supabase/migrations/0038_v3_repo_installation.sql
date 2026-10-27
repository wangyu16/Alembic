-- 0038: which GitHub App installation owns a course's repositories
-- (workspace v3, permissions §4.4, queue-and-jobs §6).
--
-- clientForCourse uses this installation for every GitHub call about the
-- course, whoever acts (owner, co-author, agent, worker), with tokens scoped
-- to the course's two repositories. Service-role only: authenticated has no
-- grant on new columns (column grants, 0025).
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any.

alter table public.packages add column repo_installation_id bigint;

comment on column public.packages.repo_installation_id is
  'GitHub App installation on the account that owns the course repositories (v3). Set at course creation and when a transfer completes; service-role only.';
