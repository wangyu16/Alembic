-- M20 (external-edit reconciliation): track the last commit SHA Alembic synced
-- to the public repo, so foreign commits (edits made directly in VS Code/GitHub)
-- can be detected and reconciled. This is rebuildable projection metadata, not a
-- source of truth — NULL means "never synced / unknown" and is treated as a full
-- reconcile. Safe to backfill as NULL.
alter table public.packages add column if not exists last_synced_sha text;
