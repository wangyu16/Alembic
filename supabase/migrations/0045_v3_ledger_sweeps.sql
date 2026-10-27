-- 0045: Ledger sweeps run by the worker's schedules (workspace v3, A15/C1;
-- ledger-v3 §3.4 L-16, §9.7).
--
-- ledger_sweep_orphans: releases the holds of jobs that ended, and of running
--   jobs with no ledger activity for p_idle (their sandbox is gone; the job is
--   cancelled so it can't capture later). Paused jobs keep their hold: they
--   wait for a person and resume with it.
-- ledger_month_end: returns every ended month's course allowance to the
--   owner (once per month), and moves anything that came back to an ended
--   allowance later (a late release or refund) to the owner too.
-- Both are idempotent and safe to run from several workers at once.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0044.

create function public.ledger_sweep_orphans(p_idle interval default interval '1 hour')
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    select h.job_id, j.status
      from public.holds h join public.ai_jobs j on j.id = h.job_id
     where h.status = 'open'
       and (j.status in ('done', 'cancelled')
            or (j.status = 'running'
                and greatest(j.created_at, coalesce((select max(e.created_at) from public.ledger_entries e where e.job_id = h.job_id), j.created_at))
                    < now() - p_idle))
  loop
    if r.status = 'running' then
      update public.ai_jobs set status = 'cancelled' where id = r.job_id and status = 'running';
    end if;
    perform public.ledger_release(r.job_id);
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.ledger_month_end()
returns int language plpgsql security definer set search_path = '' as $$
declare a record; v_owner uuid; v_back numeric; v_key text; n int := 0;
begin
  for a in
    select id, package_id, month from public.ledger_accounts
     where kind = 'course-allowance' and month < date_trunc('month', now())::date
  loop
    if not exists (select 1 from public.ledger_entries where idempotency_key = 'return:' || a.package_id || ':' || a.month) then
      perform public.ledger_allowance_return(a.package_id, a.month);
      n := n + 1;
      continue;
    end if;
    -- Late credit on an ended allowance (§9.7): straight back to the owner.
    perform 1 from public.ledger_accounts where id = a.id for update;
    v_back := coalesce((select sum(remaining) from public.credit_lots where account_id = a.id), 0);
    if v_back <= 0 then continue; end if;
    select user_id into v_owner from public.course_members where package_id = a.package_id and role = 'owner';
    v_key := 'late-return:' || a.id || ':' || (select count(*) from public.ledger_entries where account_id = a.id and kind = 'transfer-out');
    update public.credit_lots set remaining = 0 where account_id = a.id;
    insert into public.ledger_entries (account_id, kind, amount, idempotency_key) values (a.id, 'transfer-out', v_back, v_key);
    perform public.ledger_new_lot(public.ledger_user_account(v_owner), 'paid', v_key, v_back, null, 'transfer-in', v_key || ':in');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.ledger_sweep_orphans(interval) from public, anon, authenticated;
revoke execute on function public.ledger_month_end() from public, anon, authenticated;
grant execute on function public.ledger_sweep_orphans(interval) to service_role;
grant execute on function public.ledger_month_end() to service_role;
