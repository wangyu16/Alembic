-- 0052: Durable gateway usage (C2 review fix, MEDIUM 3).
--
-- Every call the gateway forwards is written here (usage numbers only, never
-- prompts) before it is charged. A charge that fails stays `captured = false`
-- and the worker retries it, so a database hiccup never makes a call free.
-- Service role only.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0051.

create table public.gateway_usage (
  job_id     uuid not null references public.ai_jobs (id) on delete cascade,
  call_id    text not null,
  model      text not null,
  usage      jsonb not null,
  usd        numeric(14,8) not null check (usd >= 0),
  credits    numeric(14,4) not null check (credits >= 0),
  captured   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (job_id, call_id)
);
create index gateway_usage_uncaptured on public.gateway_usage (created_at) where not captured;
alter table public.gateway_usage enable row level security;
revoke all on public.gateway_usage from anon, authenticated;

-- Retry charges that failed (worker schedule). ledger_capture is idempotent per call id.
create function public.gateway_capture_pending(p_limit int default 100)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select job_id, call_id, credits from public.gateway_usage where not captured order by created_at limit p_limit loop
    perform public.ledger_capture(r.job_id, r.call_id, r.credits);
    update public.gateway_usage set captured = true where job_id = r.job_id and call_id = r.call_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.gateway_capture_pending(int) from public, anon, authenticated;
grant execute on function public.gateway_capture_pending(int) to service_role;
