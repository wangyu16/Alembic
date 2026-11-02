-- 0060: Members see the write queue's status, not its contents (real-course
-- loop, audit r2 #11).
--
-- 0037 let every member read whole rows, including other members' queued
-- and refused texts (payload) and results. The workspace only shows status
-- (e.g. a chapter's status change still saving); the worker reads rows as
-- the service role. Column-level grant: payload, result, last_error,
-- planned_shas and pusher_login are no longer readable by members.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any.

revoke select on public.write_queue from authenticated;
grant select (id, package_id, seq, kind, actor_id, idem_key, priority, status, attempts, next_attempt_at, created_at, finished_at)
  on public.write_queue to authenticated;
