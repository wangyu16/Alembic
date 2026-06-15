-- M14 accessibility: surface a package's accessibility status on the public
-- discovery index. The status itself lives in the package manifest (a
-- rebuildable projection of repo content); this column is the portal projection.

alter table public.portal_registrations
  add column if not exists accessibility_status text
    not null default 'unknown'
    check (accessibility_status in ('pass', 'warn', 'fail', 'unknown'));
