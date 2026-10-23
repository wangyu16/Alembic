-- Phase 5 hardening (2026-10-23): a database-side cap on portal reports, and
-- an index for the paged research export. Additive; safe to apply before or
-- after the code (the app falls back to the old direct insert while
-- `file_portal_report` does not exist yet).
--
-- 1. Reports go through one capped door.
--    Before: RLS "anyone can report" let any holder of the PUBLIC anon key
--    insert into portal_reports directly, past the app's per-address limit
--    (Track A.6). Now the direct insert is closed for anon/authenticated, and
--    the only insert path is `file_portal_report`, executable by the service
--    role only — i.e. the app's report action, which applies the per-address
--    limit first (5 / 10 min, 20 / day; lib/rate-limit.ts). Anonymous
--    reporting stays possible (portal-governance.md): the app files the
--    report for a signed-out visitor exactly as before.
--
--    The function adds caps the app cannot apply per address, counted in the
--    same `rate_limit_hit` counters (migration 0023 — required first):
--      per package: 10 / hour and 30 / day
--      all reports: 60 / hour and 300 / day
--    These bound the table even against a client rotating addresses. A flood
--    can at worst pause reporting until the window rolls over; reports are
--    operator-reviewed, rare and human, so that is the safer failure.

drop policy if exists "anyone can report" on public.portal_reports;
revoke insert on public.portal_reports from anon, authenticated;

create or replace function public.file_portal_report(
  p_package_id text,
  p_reason text,
  p_reporter_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_pkg_key text;
  v_hour integer;
  v_day integer;
begin
  if p_package_id is null or length(p_package_id) = 0 or length(p_package_id) > 200 or v_reason = '' then
    return 'invalid';
  end if;
  -- Global caps first, so fresh per-package keys cannot be used to dodge them.
  -- Every window is counted (no reliance on boolean short-circuit order).
  v_hour := public.rate_limit_hit('report:all', 3600);
  v_day := public.rate_limit_hit('report:all', 86400);
  if v_hour > 60 or v_day > 300 then
    return 'rate_limited';
  end if;
  v_pkg_key := 'report:pkg:' || md5(p_package_id);
  v_hour := public.rate_limit_hit(v_pkg_key, 3600);
  v_day := public.rate_limit_hit(v_pkg_key, 86400);
  if v_hour > 10 or v_day > 30 then
    return 'rate_limited';
  end if;
  insert into public.portal_reports (package_id, reporter_id, reason)
    values (p_package_id, p_reporter_id, left(v_reason, 2000));
  return 'ok';
end;
$$;

comment on function public.file_portal_report(text, text, uuid) is
  'The only insert path into portal_reports (Phase 5 hardening). Service role only; returns ok | rate_limited | invalid.';

revoke all on function public.file_portal_report(text, text, uuid) from public, anon, authenticated;
grant execute on function public.file_portal_report(text, text, uuid) to service_role;

-- 2. Keyset index for the paged research export (/admin/export walks
--    research_events by (occurred_at, id) in batches of 1000).
create index if not exists research_events_export_idx
  on public.research_events (occurred_at, id);
