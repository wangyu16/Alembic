-- Admin / operations module (M35). A platform admin flag for the grant team:
-- gates the /admin module (status, error monitoring, de-identified research
-- export, participant eligibility, report review). Default false; the operator
-- flags admins in the dashboard. Admin reads use the service role behind this
-- gate (no RLS bypass for normal users).
alter table public.profiles
  add column if not exists is_admin boolean not null default false;
