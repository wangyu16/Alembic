-- 0054: AI gateway review round 3 (LOW): usage recorded but not yet
-- captured (a charge the worker will retry) counts against the job's
-- remaining credit, so it can't be spent again meanwhile.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0053.

create or replace function public.gateway_key_check(p_hash text)
returns table (job_id uuid, models text[], remaining numeric)
language sql stable security definer set search_path = '' as $$
  select k.job_id, k.models,
         (h.drawn - h.captured
          - coalesce((select sum(u.credits) from public.gateway_usage u where u.job_id = k.job_id and not u.captured), 0))
    from public.gateway_keys k
    join public.ai_jobs j on j.id = k.job_id and j.status = 'running'
    join public.holds h on h.job_id = k.job_id and h.status = 'open'
   where k.key_hash = p_hash and k.revoked_at is null and k.expires_at > now()
$$;
