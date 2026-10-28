-- 0050: AI gateway keys (workspace v3, C2; ledger-v3 §3.5, agent-runtime-v3).
--
-- One key per AI job: Alembic mints a random token, stores only its sha256
-- here, and hands the token to the caller (a quick ask, try mode, a sandbox).
-- The gateway accepts it only while the key is live, its job is running and
-- the job's hold is open; every call is charged to that hold with
-- ledger_capture. Prompts and answers are never stored. Service role only.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0049.

create table public.gateway_keys (
  key_hash    text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  job_id      uuid not null references public.ai_jobs (id) on delete cascade,
  models      text[] not null check (cardinality(models) > 0),  -- allowed model ids
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index gateway_keys_job on public.gateway_keys (job_id);
alter table public.gateway_keys enable row level security;
revoke all on public.gateway_keys from anon, authenticated;

-- What the gateway needs to accept a call: the job, its allowed models, and
-- how much of its hold is left (drawn + margin − captured).
create function public.gateway_key_check(p_hash text)
returns table (job_id uuid, models text[], remaining numeric)
language sql stable security definer set search_path = '' as $$
  select k.job_id, k.models, (h.drawn + h.margin - h.captured)
    from public.gateway_keys k
    join public.ai_jobs j on j.id = k.job_id and j.status = 'running'
    join public.holds h on h.job_id = k.job_id and h.status = 'open'
   where k.key_hash = p_hash and k.revoked_at is null and k.expires_at > now()
$$;

create function public.gateway_revoke_job(p_job uuid)
returns void language sql security definer set search_path = '' as $$
  update public.gateway_keys set revoked_at = now() where job_id = p_job and revoked_at is null;
$$;

do $$
declare f text;
begin
  foreach f in array array['gateway_key_check(text)', 'gateway_revoke_job(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
