-- 0069: the agent runtime's records (agent-runtime-v3 §1, as amended by §11–§16; C4 step 2).
--
-- One session per course, its jobs (at most one running), the session's event log, and the registry of the
-- changesets an agent hands in. Questions and the digest are Needs-you items (0040: the agent may raise only
-- `question`). Every write is the server's (the agent endpoints and the worker, with the service role, behind the
-- agent token's checks): no write grant for the API roles. Members read their course's rows.
--
-- READ-ONLY PRE-CHECK: none (new tables). DEPLOY ORDER: any.

create table if not exists public.agent_sessions (
  id              text primary key check (id ~ '^as-[a-z0-9]{12}$'),
  package_id      text not null unique references public.packages (id) on delete cascade,
  state           text not null default 'idle' check (state in ('idle', 'running', 'paused:owner', 'paused:handout')),
  sandbox_ref     text check (sandbox_ref is null or length(sandbox_ref) <= 200),
  harness         text check (harness is null or length(harness) <= 100),
  harness_version text check (harness_version is null or length(harness_version) <= 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.agent_jobs (
  id             text primary key check (id ~ '^aj-[a-z0-9]{12}$'),
  session_id     text not null references public.agent_sessions (id) on delete cascade,
  package_id     text not null references public.packages (id) on delete cascade,
  invoker_id     uuid references public.profiles (id) on delete set null,
  automatic      boolean not null default false,
  -- Automatic jobs are paid from the course and capped at co-author rights (§10.4, §15 M7).
  payer          text not null check (payer in ('invoker', 'course')),
  rights_cap     text check (rights_cap is null or rights_cap = 'co-author'),
  check (not automatic or (payer = 'course' and rights_cap is not distinct from 'co-author')),
  task           text not null check (length(task) between 1 and 4000),
  status         text not null default 'starting' check (status in ('starting', 'running', 'done', 'failed', 'cancelled', 'paused')),
  budget_credits numeric(12, 4) not null check (budget_credits > 0),
  spent_credits  numeric(12, 4) not null default 0 check (spent_credits >= 0),
  gateway_key_id text check (gateway_key_id is null or length(gateway_key_id) <= 200),
  signing_kid    text check (signing_kid is null or length(signing_kid) <= 100),
  summary        text check (summary is null or length(summary) <= 4000),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz
);
-- One live job per session (§1).
create unique index if not exists agent_jobs_one_live on public.agent_jobs (session_id) where status in ('starting', 'running');
create index if not exists agent_jobs_package_idx on public.agent_jobs (package_id, started_at desc);

create table if not exists public.agent_session_events (
  session_id text not null references public.agent_sessions (id) on delete cascade,
  seq        bigint generated always as identity,
  job_id     text references public.agent_jobs (id) on delete set null,
  kind       text not null check (kind in ('message', 'tool', 'progress', 'question', 'handover-note')),
  payload    jsonb not null default '{}' check (pg_column_size(payload) <= 65536),
  at         timestamptz not null default now(),
  primary key (session_id, seq)
);
create index if not exists agent_session_events_at_idx on public.agent_session_events (at); -- 90-day retention sweep

create table if not exists public.agent_changesets (
  id           text primary key check (id ~ '^[A-Za-z0-9_-]{8,64}$'),
  package_id   text not null references public.packages (id) on delete cascade,
  job_id       text not null references public.agent_jobs (id) on delete cascade,
  invoker_id   uuid references public.profiles (id) on delete set null,
  status       text not null check (status in ('proposed', 'pending', 'queued', 'done', 'refused', 'failed', 'purged')),
  queue_row_id uuid,
  depends_on   text references public.agent_changesets (id) on delete set null,
  files        int not null default 0 check (files between 0 and 1000),
  record_bytes int not null default 0 check (record_bytes >= 0),
  reason       text check (reason is null or length(reason) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists agent_changesets_job_idx on public.agent_changesets (job_id, created_at);

alter table public.agent_sessions enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.agent_session_events enable row level security;
alter table public.agent_changesets enable row level security;

revoke all on public.agent_sessions, public.agent_jobs, public.agent_session_events, public.agent_changesets from anon, authenticated;
grant select on public.agent_sessions, public.agent_jobs, public.agent_session_events, public.agent_changesets to authenticated;

drop policy if exists agent_sessions_members_read on public.agent_sessions;
create policy agent_sessions_members_read on public.agent_sessions for select to authenticated
  using ((select public.course_role(package_id)) is not null);
drop policy if exists agent_jobs_members_read on public.agent_jobs;
create policy agent_jobs_members_read on public.agent_jobs for select to authenticated
  using ((select public.course_role(package_id)) is not null);
drop policy if exists agent_changesets_members_read on public.agent_changesets;
create policy agent_changesets_members_read on public.agent_changesets for select to authenticated
  using ((select public.course_role(package_id)) is not null);
drop policy if exists agent_session_events_members_read on public.agent_session_events;
create policy agent_session_events_members_read on public.agent_session_events for select to authenticated
  using (exists (select 1 from public.agent_sessions s where s.id = session_id and (select public.course_role(s.package_id)) is not null));
