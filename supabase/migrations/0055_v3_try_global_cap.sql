-- 0055: Try mode review fix (M1): a global hourly cap on demo runs, so
-- rotating browsers or addresses can't drain the month's demo budget fast.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0054.

create or replace function public.try_start(p_browser text, p_network text, p_estimate numeric,
                                            p_per_browser int default 3, p_per_network int default 20,
                                            p_per_hour int default 60)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_acc uuid; v_job uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('try-global', 0));
  perform pg_advisory_xact_lock(hashtextextended('try-network:' || p_network, 0));
  perform pg_advisory_xact_lock(hashtextextended('try-browser:' || p_browser, 0));
  select id into v_acc from public.ledger_accounts where kind = 'demo-budget' and month = date_trunc('month', now())::date;
  if v_acc is null then raise exception 'try mode is resting: no demo budget this month' using errcode = '53400'; end if;
  if (select count(*) from public.try_runs where created_at > now() - interval '1 hour') >= p_per_hour then
    raise exception 'try mode is busy: hourly limit reached' using errcode = '53400';
  end if;
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
drop function if exists public.try_start(text, text, numeric, int, int);
revoke execute on function public.try_start(text, text, numeric, int, int, int) from public, anon, authenticated;
grant execute on function public.try_start(text, text, numeric, int, int, int) to service_role;
