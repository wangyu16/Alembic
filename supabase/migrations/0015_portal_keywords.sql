-- Discover search accuracy (owner request 2026-07-09): surface the course's
-- tags/keywords on the public discovery index, alongside description, so
-- search can match on them (not just title). Projection column, same
-- pattern as accessibility_status (0006) — the source of truth is
-- manifest.keywords; this is the portal-side copy, refreshed on
-- registration/update.

alter table public.portal_registrations
  add column if not exists keywords text[] not null default '{}';
