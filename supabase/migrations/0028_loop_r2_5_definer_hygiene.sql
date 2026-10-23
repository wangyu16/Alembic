-- Security loop r2 (round-2 audit, 2026-10-23), finding LOW-3 (P5.S.14) and
-- a privilege sweep (P5.S.15). NOT APPLIED anywhere yet.
--
-- THE HOLE. Three SECURITY DEFINER functions ran with `search_path = public`
-- (file_portal_report, file_portal_report_v2, rate_limit_hit). Their bodies
-- qualify every name, but a definer function whose path includes a schema the
-- API roles can create objects in is one CREATE away from a hijack; every
-- other definer function pins `search_path = ''`.
--
-- THE FIX. Pin the three (bodies already schema-qualify everything; built-ins
-- resolve through pg_catalog, which is always searched). A test now asserts
-- every SECURITY DEFINER function in public has search_path="".
--
-- Sweep (defence in depth; each was already inert because RLS has no policy
-- for the command): the API roles lose UPDATE on research_events and
-- portal_reports, and every privilege on rate_limit_counters (only the
-- definer rate_limit_hit touches it).
--
-- DEPLOY ORDER: either order; independent of the code. Read-only pre-check:
--   select p.oid::regprocedure, p.proconfig from pg_proc p
--   where p.pronamespace = 'public'::regnamespace and p.prosecdef
--     and not ('search_path=""' = any (coalesce(p.proconfig, '{}')));

alter function public.file_portal_report(text, text, uuid) set search_path = '';
alter function public.file_portal_report_v2(text, text, uuid, text) set search_path = '';
alter function public.rate_limit_hit(text, integer) set search_path = '';

revoke update on public.research_events from anon, authenticated;
revoke update on public.portal_reports from anon, authenticated;
revoke all on public.rate_limit_counters from anon, authenticated;
