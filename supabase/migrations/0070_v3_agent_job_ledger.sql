-- 0070: an agent job's ledger job (agent-runtime-v3 §1 `jobs.payer_account_id`, ledger 0039 "the agent runtime, C4,
-- extends this table"): the AI calls of an agent job are charged to its `ai_jobs` row through that row's hold and
-- gateway key. One ledger job per agent job.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0069.
alter table public.agent_jobs add column if not exists ai_job_id uuid unique references public.ai_jobs (id);
