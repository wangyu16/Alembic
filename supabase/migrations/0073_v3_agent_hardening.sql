-- 0073: C4 attack round fixes (agent-runtime §18): a per-job secret so a job is named by something only its own course
-- user can read; settling a job's credit only after any call in flight has been charged; a lease so one worker acts on
-- a sandbox at a time.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0072, before the worker that uses these columns.
alter table public.agent_jobs add column if not exists job_secret_hash text check (job_secret_hash is null or job_secret_hash ~ '^[0-9a-f]{64}$');
alter table public.agent_jobs add column if not exists settled_at timestamptz;
alter table public.agent_sandboxes add column if not exists lease_holder text check (lease_holder is null or length(lease_holder) <= 200);
alter table public.agent_sandboxes add column if not exists lease_until timestamptz;
-- Jobs that ended before this migration are settled already (their holds were released when they ended).
update public.agent_jobs set settled_at = coalesce(ended_at, now()) where settled_at is null and status in ('done', 'failed', 'cancelled');
