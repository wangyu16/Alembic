-- 0051: Try mode (workspace v3, C7; design §11.5, §12.5).
--
-- The demo budget: one demo-budget account per month, funded by the operator
-- (granted credit expiring at the month's end). A demo run is a 'try' job paid
-- by that account, under caps: a few runs per browser per day, a per-network
-- daily cap, and the month's budget. try_runs keeps only hashes of the
-- browser token and network address (for the caps), never the topic.
-- Service role only.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0050.

create table public.try_runs (
  job_id       uuid primary key references public.ai_jobs (id) on delete cascade,
  browser_hash text not null check (browser_hash ~ '^[0-9a-f]{64}$'),
  network_hash text not null check (network_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now()
);
create index try_runs_browser on public.try_runs (browser_hash, created_at);
create index try_runs_network on public.try_runs (network_hash, created_at);
alter table public.try_runs enable row level security;
revoke all on public.try_runs from anon, authenticated;

-- The operator funds this month's (or a later month's) demo budget.
create function public.ledger_demo_fund(p_actor uuid, p_month date, p_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date; v_acc uuid; v_key text;
begin
  if not coalesce((select is_admin from public.profiles where id = p_actor), false) then
    raise exception 'Only the operator funds the demo budget' using errcode = '42501';
  end if;
  if p_amount <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if v_month < date_trunc('month', now())::date then raise exception 'That month has ended' using errcode = '22023'; end if;
  insert into public.ledger_accounts (kind, month) values ('demo-budget', v_month) on conflict (month) where kind = 'demo-budget' do nothing;
  select id into v_acc from public.ledger_accounts where kind = 'demo-budget' and month = v_month;
  perform 1 from public.ledger_accounts where id = v_acc for update;
  v_key := 'demo-fund:' || v_month || ':' || (select count(*) from public.ledger_entries where account_id = v_acc and kind = 'grant');
  perform public.ledger_new_lot(v_acc, 'granted', v_key, p_amount, (v_month + interval '1 month')::timestamptz, 'grant', v_key);
end $$;

-- Start a demo run: caps, then a 'try' job with a hold on this month's demo budget.
create function public.try_start(p_browser text, p_network text, p_estimate numeric,
                                 p_per_browser int default 3, p_per_network int default 20)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_acc uuid; v_job uuid;
begin
  select id into v_acc from public.ledger_accounts where kind = 'demo-budget' and month = date_trunc('month', now())::date;
  if v_acc is null then raise exception 'try mode is resting: no demo budget this month' using errcode = '53400'; end if;
  if (select count(*) from public.try_runs where browser_hash = p_browser and created_at > now() - interval '1 day') >= p_per_browser then
    raise exception 'daily limit for this browser reached' using errcode = '53400';
  end if;
  if (select count(*) from public.try_runs where network_hash = p_network and created_at > now() - interval '1 day') >= p_per_network then
    raise exception 'daily limit for this network reached' using errcode = '53400';
  end if;
  insert into public.ai_jobs (payer_account_id, kind) values (v_acc, 'try') returning id into v_job;
  perform public.ledger_hold(null, v_job, p_estimate);  -- 'Not enough credit' (53400) when the month's budget is used up
  insert into public.try_runs (job_id, browser_hash, network_hash) values (v_job, p_browser, p_network);
  return v_job;
end $$;

-- End a demo run: unused credit back to the budget; the job's keys stop working.
create function public.try_finish(p_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.try_runs where job_id = p_job) then raise exception 'not a demo run' using errcode = '22023'; end if;
  update public.ai_jobs set status = 'done' where id = p_job and status = 'running';
  perform public.ledger_release(p_job);
  perform public.gateway_revoke_job(p_job);
end $$;

do $$
declare f text;
begin
  foreach f in array array['ledger_demo_fund(uuid, date, numeric)', 'try_start(text, text, numeric, int, int)', 'try_finish(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
