-- GitHub publishing (M5). Records the App installation per user and the paired
-- repositories per package. Repos are the source of truth once a package
-- graduates; these columns let the app find them.

alter table public.profiles
  add column github_installation_id bigint;

alter table public.packages
  add column public_repo jsonb,    -- { "owner": "...", "name": "..." }
  add column private_repo jsonb,   -- { "owner": "...", "name": "..." }
  add column default_branch text not null default 'main';
