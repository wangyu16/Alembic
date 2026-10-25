-- 0034: rate-limit counters are keyed by window size as well as window start.
--
-- BUG (found 2026-10-25 when CI ran in the first hour of a UTC day):
-- rate_limit_hit stored one row per (key, window_start). Every caller charges
-- the same key against an hourly AND a daily window (reports, preview,
-- reconcile, accessibility checks, suggestions). During the first hour of each
-- UTC day both windows start at midnight, so they shared one row and every
-- hit counted twice: each cap was effectively halved for that hour.
--
-- FIX: the stored key carries the window size ("<key>#<seconds>"), so the
-- windows never share a counter. Body otherwise as 0023, with the
-- search_path='' hygiene of 0028_loop_r2_5 (every name qualified).
--
-- READ-ONLY PRE-CHECK: none needed. Existing counter rows (old key form) are
-- simply no longer read; they expire through the 2-day prune.
-- DEPLOY ORDER: either order with the code (signature unchanged).

create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  w timestamptz;
  n integer;
begin
  if p_window_seconds is null or p_window_seconds < 1 or length(p_key) > 128 then
    raise exception 'bad rate-limit arguments';
  end if;
  w := pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from pg_catalog.now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_counters as c (key, window_start, hits)
    values (p_key || '#' || p_window_seconds::text, w, 1)
    on conflict (key, window_start) do update set hits = c.hits + 1
    returning c.hits into n;
  if pg_catalog.random() < 0.01 then
    delete from public.rate_limit_counters where window_start < pg_catalog.now() - interval '2 days';
  end if;
  return n;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
