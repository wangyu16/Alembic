-- Security loop r1 (2026-10-23), finding M4: report caps that junk cannot
-- exhaust. NOT APPLIED anywhere yet. Requires 0023, 0024, 0025_loop_r1_1 and
-- 0025_loop_r1_2 (listability).
--
-- THE HOLE. file_portal_report (0024) charged its caps BEFORE validating the
-- package, and portal_reports.package_id has no foreign key: 10 junk reports
-- on a package silenced it for an hour (an infringer pre-fills its own cap),
-- and 60 reports on made-up ids silenced reporting everywhere. Repro:
-- /tmp/alembic-audit/report.mts.
--
-- THE FIX. file_portal_report_v2(package, reason, reporter_id, reporter_key):
--   1. validate first: a non-blank reason, a package that EXISTS and is
--      LISTED — a listed course (discovery_course_listable) or a published
--      course with at least one shared element (discovery_element_listable),
--      i.e. something a visitor can actually see on Discover. Anything else
--      answers 'invalid', stores nothing and charges no counter;
--   2. per (package, reporter key): 5 / hour and 10 / day. The app passes an
--      HMAC of the signed-in user id, or of the client address for an
--      anonymous visitor (lib/report-submit.ts) — never the address itself.
--      One source can no longer exhaust a package's reports; a source that
--      sends no key shares one bucket per package;
--   3. the global caps (60 / hour, 300 / day) are charged only by a valid
--      report that passed its source cap.
--   The old three-argument file_portal_report is kept (additive) and now
--   delegates to v2 with no reporter key, so the pre-loop-r1 app validates too.
--   Anonymous reporting stays possible (portal-governance.md).
--
-- Residual (documented): a client rotating addresses AND naming real listed
-- packages can still use up the global cap for the hour — the same bound as
-- before, now at least paid for with valid reports, each stored for review.
-- No foreign key is added: reports are operator records and must survive the
-- package row (a purged package's reports stay reviewable).
--
-- DEPLOY ORDER: either order. Applied first, the old app's calls land in the
-- validating three-argument function. Code first, the new app's v2 call falls
-- back to the three-argument function while v2 is missing (lib/report-submit.ts).

create or replace function public.file_portal_report_v2(
  p_package_id text,
  p_reason text,
  p_reporter_id uuid default null,
  p_reporter_key text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_src_key text;
  v_hour integer;
  v_day integer;
begin
  -- 1. Validate before anything is counted.
  if p_package_id is null or length(p_package_id) = 0 or length(p_package_id) > 200
     or v_reason = ''
     or (p_reporter_key is not null and (length(p_reporter_key) = 0 or length(p_reporter_key) > 128)) then
    return 'invalid';
  end if;
  if not (
    public.discovery_course_listable(p_package_id)
    or exists (
      select 1 from public.documents d
      where d.package_id = p_package_id
        and public.discovery_element_listable(d.doc_id)
    )
  ) then
    return 'invalid';
  end if;

  -- 2. Per (package, source).
  v_src_key := 'report:src:' || md5(p_package_id || '|' || coalesce(p_reporter_key, ''));
  v_hour := public.rate_limit_hit(v_src_key, 3600);
  v_day := public.rate_limit_hit(v_src_key, 86400);
  if v_hour > 5 or v_day > 10 then
    return 'rate_limited';
  end if;

  -- 3. Global, charged only by a valid report within its source's share.
  v_hour := public.rate_limit_hit('report:all', 3600);
  v_day := public.rate_limit_hit('report:all', 86400);
  if v_hour > 60 or v_day > 300 then
    return 'rate_limited';
  end if;

  insert into public.portal_reports (package_id, reporter_id, reason)
    values (p_package_id, p_reporter_id, left(v_reason, 2000));
  return 'ok';
end;
$$;

comment on function public.file_portal_report_v2(text, text, uuid, text) is
  'The insert path into portal_reports (security loop r1 M4): validates the package is listed before charging caps; per (package, reporter key) 5/h 10/day; global 60/h 300/day. Service role only.';

revoke all on function public.file_portal_report_v2(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.file_portal_report_v2(text, text, uuid, text) to service_role;

-- The 0024 entry point, kept for the pre-loop-r1 app: same validation.
create or replace function public.file_portal_report(
  p_package_id text,
  p_reason text,
  p_reporter_id uuid default null
)
returns text
language sql
security definer
set search_path = public
as $$
  select public.file_portal_report_v2(p_package_id, p_reason, p_reporter_id, null)
$$;

revoke all on function public.file_portal_report(text, text, uuid) from public, anon, authenticated;
grant execute on function public.file_portal_report(text, text, uuid) to service_role;
