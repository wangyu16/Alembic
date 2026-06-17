-- Portal governance scaffolding (M33). During the grant, registration on the
-- public index is limited to study participants, and there is a reporting path
-- whose entries operators review. Full moderation + stewardship handoff is
-- Phase 8 (open registration with moderation, named stewardship).

-- Eligibility: only flagged participants may list on the public index. Default
-- false — the operator/grant team opts participants in (dashboard) during the study.
alter table public.profiles
  add column if not exists portal_eligible boolean not null default false;

-- Reports against listed packages. Operator-reviewed — there is no in-app admin
-- UI yet (the Phase-7 admin module reads these). Reporters may be signed-in or
-- anonymous (reporter_id null).
create table public.portal_reports (
  id bigint generated always as identity primary key,
  package_id text not null,
  reporter_id uuid references public.profiles (id) on delete set null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

create index portal_reports_status_idx on public.portal_reports (status, created_at desc);

alter table public.portal_reports enable row level security;

-- Anyone may file a report; nobody but operators (service role / dashboard) may
-- read or resolve them — no select/update policy for normal users.
create policy "anyone can report" on public.portal_reports
  for insert with check (true);
