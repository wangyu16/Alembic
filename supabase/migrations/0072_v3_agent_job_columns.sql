-- 0072: members read only what the Assistant page shows of a job (C4 attack round L5): never the sealed gateway key,
-- its id, the signing key id, the ledger job or the sandbox's user name for the course.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0071 (and with the web build that selects these columns only).
revoke select on public.agent_jobs from authenticated;
grant select (id, session_id, package_id, invoker_id, automatic, payer, rights_cap, task, status, budget_credits, spent_credits, summary, started_at, ended_at)
  on public.agent_jobs to authenticated;
