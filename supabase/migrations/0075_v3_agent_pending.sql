-- 0075: a hand-in waits while a person is typing in one of its files (agent-runtime §4.1, §14.5): its queue payload is
-- kept here until the worker queues it (the person paused for 2 minutes, or 30 minutes at most).
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0074, with the worker that promotes pending hand-ins.
alter table public.agent_changesets add column if not exists pending_payload jsonb check (pending_payload is null or pg_column_size(pending_payload) <= 50 * 1024 * 1024);
alter table public.agent_changesets add column if not exists pending_paths text[];
create index if not exists agent_changesets_pending on public.agent_changesets (created_at) where status = 'pending';
