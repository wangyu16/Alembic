-- 0074: members see whether a job's credit has been settled (C4 attack round 2, L1: "settling…" instead of "0 credits").
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0073.
grant select (settled_at) on public.agent_jobs to authenticated;
