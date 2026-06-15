-- Risk-tiered approvals (M10). Records auto-applied Tier-1 changes (with their
-- inverse, for one-click undo) and the Tier-2 review queue. Platform records —
-- not package documents.

create table public.package_changes (
  id bigint generated always as identity primary key,
  package_id text not null references public.packages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  tier smallint not null check (tier in (1, 2, 3)),
  kind text not null,                 -- ChangeKind from the contract
  summary text not null,
  -- For Tier-2 items: the proposed payload (e.g. drafted block).
  detail jsonb not null default '{}',
  -- For Tier-1 applied changes: what's needed to undo (e.g. prior file content).
  inverse jsonb,
  status text not null
    check (status in ('pending', 'applied', 'accepted', 'rejected', 'undone')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index package_changes_pkg_status_idx
  on public.package_changes (package_id, status, created_at desc);

alter table public.package_changes enable row level security;

-- Owner-only: a change belongs to the user, scoped to a package they own.
create policy "owner manages changes" on public.package_changes
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Per-package review policy: when true, nothing auto-applies (review floor = 2).
alter table public.packages
  add column review_all boolean not null default false;
