-- 0053: AI gateway review round 2 fixes (C2).
--
-- * A call may spend only what was set aside for its job (drawn − captured);
--   the margin absorbs estimation error, it isn't spendable (M1).
-- * try_start's caps are counted under per-browser and per-network locks (M2).
-- * gateway_capture_pending retries one row at a time; a row that keeps
--   failing no longer stalls the others (LOW).
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0052.

create or replace function public.gateway_key_check(p_hash text)
returns table (job_id uuid, models text[], remaining numeric)
language sql stable security definer set search_path = '' as $$
  select k.job_id, k.models, (h.drawn - h.captured)
    from public.gateway_keys k
    join public.ai_jobs j on j.id = k.job_id and j.status = 'running'
    join public.holds h on h.job_id = k.job_id and h.status = 'open'
   where k.key_hash = p_hash and k.revoked_at is null and k.expires_at > now()
$$;

create or replace function public.try_start(p_browser text, p_network text, p_estimate numeric,
                                            p_per_browser int default 3, p_per_network int default 20)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_acc uuid; v_job uuid;
begin
  -- Count under locks, so parallel starts can't all slip under the caps.
  perform pg_advisory_xact_lock(hashtextextended('try-network:' || p_network, 0));
  perform pg_advisory_xact_lock(hashtextextended('try-browser:' || p_browser, 0));
  select id into v_acc from public.ledger_accounts where kind = 'demo-budget' and month = date_trunc('month', now())::date;
  if v_acc is null then raise exception 'try mode is resting: no demo budget this month' using errcode = '53400'; end if;
  if (select count(*) from public.try_runs where browser_hash = p_browser and created_at > now() - interval '1 day') >= p_per_browser then
    raise exception 'daily limit for this browser reached' using errcode = '53400';
  end if;
  if (select count(*) from public.try_runs where network_hash = p_network and created_at > now() - interval '1 day') >= p_per_network then
    raise exception 'daily limit for this network reached' using errcode = '53400';
  end if;
  insert into public.ai_jobs (payer_account_id, kind) values (v_acc, 'try') returning id into v_job;
  perform public.ledger_hold(null, v_job, p_estimate);
  insert into public.try_runs (job_id, browser_hash, network_hash) values (v_job, p_browser, p_network);
  return v_job;
end $$;

create or replace function public.gateway_capture_pending(p_limit int default 100)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select job_id, call_id, credits from public.gateway_usage where not captured order by created_at limit p_limit loop
    begin
      perform public.ledger_capture(r.job_id, r.call_id, r.credits);
      update public.gateway_usage set captured = true where job_id = r.job_id and call_id = r.call_id;
      n := n + 1;
    exception when others then
      raise warning 'gateway capture % / % still failing: %', r.job_id, r.call_id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
