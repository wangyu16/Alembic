-- Phase 5 Track A.6–A.7 (2026-10-23): rate-limit counters and anonymous
-- discovery events. Additive; safe to apply before or after the code.
-- Until it is applied: report rate limits count in-process (per server
-- instance), and anonymous visitors' discovery events are dropped (the
-- insert fails and research logging swallows it). Signed-in events work.

-- 1. Anonymous discovery events (portal search, document views, reports by
--    signed-out visitors) have NO participant. They are written by the
--    server only (service role); the "insert own events" policy still
--    requires auth.uid() = user_id, which a null never satisfies, so a
--    browser cannot insert participant-less rows itself.
alter table public.research_events
  alter column user_id drop not null;

comment on column public.research_events.user_id is
  'Platform user (pseudonymized on export). NULL = an anonymous visitor''s discovery event (Track A.7): no participant, never an IP.';

create index if not exists research_events_type_time_idx
  on public.research_events (type, occurred_at);

-- 2. Fixed-window rate-limit counters (Track A.6; portal-governance.md).
--    Keys are an HMAC of (bucket, client IP) under a server secret — no IP is
--    stored. Rows older than two days are swept opportunistically.
create table if not exists public.rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limit_counters enable row level security;
-- No policies: only the security-definer function below touches it.

create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz;
  n integer;
begin
  if p_window_seconds is null or p_window_seconds < 1 or length(p_key) > 128 then
    raise exception 'bad rate-limit arguments';
  end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_counters as c (key, window_start, hits)
    values (p_key, w, 1)
    on conflict (key, window_start) do update set hits = c.hits + 1
    returning c.hits into n;
  if random() < 0.01 then
    delete from public.rate_limit_counters where window_start < now() - interval '2 days';
  end if;
  return n;
end;
$$;

-- Server-only: the anon key is public, so nobody else may bump or probe counters.
revoke all on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer) to service_role;
