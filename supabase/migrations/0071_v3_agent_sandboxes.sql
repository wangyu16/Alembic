-- 0071: sandboxes that may act for agent jobs, and each job's sealed gateway key (agent-runtime-v3 §18; C4 step 3b).
--
-- A sandbox proves itself with a long-lived key held by its provider's outbound proxy (the agent sees only a
-- placeholder); Alembic keeps the key's sha256. A request names its job; it is accepted only when the job is running
-- in that sandbox (agent_sessions.sandbox_ref). The job's gateway key is stored sealed (AES-256-GCM under a key derived
-- from the agent signing key) so the AI pass-through can put it into calls without the agent ever holding it.
-- Service role only.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0070.
create table if not exists public.agent_sandboxes (
  ref        text primary key check (ref ~ '^[a-z]+:[A-Za-z0-9_.-]{1,100}$'),   -- provider:id, e.g. instabox:m_…
  key_hash   text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  max_jobs   int not null default 1 check (max_jobs between 1 and 50),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
alter table public.agent_sandboxes enable row level security;
revoke all on public.agent_sandboxes from anon, authenticated;

alter table public.agent_jobs add column if not exists gateway_key_sealed text check (gateway_key_sealed is null or length(gateway_key_sealed) <= 400);
alter table public.agent_jobs add column if not exists course_user text check (course_user is null or course_user ~ '^c[a-z0-9]{1,30}$');
