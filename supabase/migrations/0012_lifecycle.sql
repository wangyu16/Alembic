-- Package lifecycle (rename / delete / archive). Sandbox packages are
-- hard-deleted (the row is removed and FK cascades clean up files). Published
-- packages are never destroyed by Alembic — "delete" archives them: the row
-- stays but is hidden from the workspace and unlisted from the portal, and can
-- be restored. True deletion is the educator's GitHub operation; when Alembic
-- detects the public repo is gone, reconciliation purges the archived row.
--
-- archived_at: null = active (listed); non-null = archived (hidden, recoverable).

alter table public.packages
  add column archived_at timestamptz;

-- Most workspace queries want only active packages; index the common filter.
create index packages_active_idx
  on public.packages (owner_id, created_at desc)
  where archived_at is null;
