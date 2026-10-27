-- 0039: the AI credit ledger (workspace v3, module C1) — core.
--
-- docs/specs/v3/ledger-v3.md (draft 3; §9 rules take precedence). Credit
-- lives in LOTS; every operation locks the account row; holds take the payer
-- from the job; overruns go to debt (the margin is a limit, not money);
-- entries are append-only. Members read only their own account. Every write
-- goes through definer functions granted to service_role only, which take
-- the actor from the server and check it themselves.
--
-- Not in this migration (later, same model): cohorts and pools, Stripe
-- refunds/disputes, the course allowance's month-end return, the orphan
-- sweep (a scheduled worker job calling ledger_release).
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any (no code depends on it yet).

create table public.ledger_accounts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('user', 'course-allowance', 'demo-budget', 'cohort-pool')),
  user_id    uuid references public.profiles (id),
  package_id text references public.packages (id),
  month      date,
  debt       numeric(14,4) not null default 0 check (debt >= 0),
  check ((kind = 'user' and user_id is not null and package_id is null and month is null)
      or (kind = 'course-allowance' and package_id is not null and month is not null and user_id is null)
      or (kind = 'demo-budget' and month is not null and user_id is null and package_id is null)
      or (kind = 'cohort-pool' and user_id is null and package_id is null and month is null))
);
create unique index ledger_accounts_user on public.ledger_accounts (user_id) where kind = 'user';
create unique index ledger_accounts_allowance on public.ledger_accounts (package_id, month) where kind = 'course-allowance';
create unique index ledger_accounts_demo on public.ledger_accounts (month) where kind = 'demo-budget';

create table public.credit_lots (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.ledger_accounts (id),
  credit_kind text not null check (credit_kind in ('granted', 'paid')),
  source      text not null,
  remaining   numeric(14,4) not null check (remaining >= 0),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (account_id, source),
  check (credit_kind = 'granted' or expires_at is null)
);

-- The jobs the ledger charges (the agent runtime, C4, extends this table).
create table public.ai_jobs (
  id               uuid primary key default gen_random_uuid(),
  package_id       text references public.packages (id),
  payer_account_id uuid not null references public.ledger_accounts (id),
  invoker_id       uuid references public.profiles (id),
  kind             text not null check (kind in ('request', 'automatic', 'checkpoint', 'deputy-draft', 'quick-ask', 'try')),
  status           text not null default 'running' check (status in ('running', 'paused', 'done', 'cancelled')),
  created_at       timestamptz not null default now()
);

create table public.holds (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null unique references public.ai_jobs (id),
  account_id uuid not null references public.ledger_accounts (id),
  status     text not null default 'open' check (status in ('open', 'released')),
  drawn      numeric(14,4) not null default 0 check (drawn >= 0),
  captured   numeric(14,4) not null default 0 check (captured >= 0),
  margin     numeric(14,4) not null check (margin >= 0)
);
create table public.hold_lots (
  hold_id uuid not null references public.holds (id),
  lot_id  uuid not null references public.credit_lots (id),
  amount  numeric(14,4) not null check (amount >= 0),
  primary key (hold_id, lot_id)
);

create table public.ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.ledger_accounts (id),
  kind            text not null check (kind in ('grant', 'top-up', 'hold', 'capture', 'overrun', 'release', 'refund', 'expiry', 'debt-paid', 'transfer-in', 'transfer-out')),
  amount          numeric(14,4) not null check (amount >= 0),
  lot_id          uuid references public.credit_lots (id),
  job_id          uuid references public.ai_jobs (id),
  idempotency_key text not null unique,
  note            text,
  created_at      timestamptz not null default now()
);

create table public.credit_grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id),
  amount     numeric(14,4) not null check (amount > 0),
  expires_at timestamptz,
  note       text,
  created_by uuid not null references public.profiles (id),
  ended_at   timestamptz,
  created_at timestamptz not null default now()
);

-- Append-only, for every role including the owner of the table.
create function public.ledger_entries_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'ledger entries are append-only' using errcode = '42501';
end $$;
create trigger ledger_entries_no_update before update or delete on public.ledger_entries
  for each row execute function public.ledger_entries_immutable();

-- Grants and RLS: members read only their own account, its lots and entries.
do $$
declare t text;
begin
  foreach t in array array['ledger_accounts','credit_lots','ai_jobs','holds','hold_lots','ledger_entries','credit_grants'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
grant select on public.ledger_accounts, public.credit_lots, public.ledger_entries to authenticated;
create policy "own account" on public.ledger_accounts for select to authenticated
  using (kind = 'user' and user_id = (select auth.uid()));
create policy "own lots" on public.credit_lots for select to authenticated
  using (exists (select 1 from public.ledger_accounts a where a.id = account_id and a.kind = 'user' and a.user_id = (select auth.uid())));
create policy "own entries" on public.ledger_entries for select to authenticated
  using (exists (select 1 from public.ledger_accounts a where a.id = account_id and a.kind = 'user' and a.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Helpers (service role only)
-- ---------------------------------------------------------------------------

create function public.ledger_user_account(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  insert into public.ledger_accounts (kind, user_id) values ('user', p_user)
  on conflict (user_id) where kind = 'user' do nothing;
  select id into v from public.ledger_accounts where kind = 'user' and user_id = p_user;
  return v;
end $$;

-- Spendable balance: unexpired lots minus debt.
create function public.ledger_balance(p_account uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(remaining) from public.credit_lots
                    where account_id = p_account and (expires_at is null or expires_at > now())), 0)
       - (select debt from public.ledger_accounts where id = p_account)
$$;

-- A new lot pays off debt first (ledger §9.6). Caller holds the account lock.
create function public.ledger_new_lot(p_account uuid, p_kind text, p_source text, p_amount numeric, p_expires timestamptz, p_entry_kind text, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_lot uuid; v_debt numeric; v_pay numeric;
begin
  select debt into v_debt from public.ledger_accounts where id = p_account;
  v_pay := least(v_debt, p_amount);
  insert into public.credit_lots (account_id, credit_kind, source, remaining, expires_at)
  values (p_account, p_kind, p_source, p_amount - v_pay, p_expires)
  returning id into v_lot;
  insert into public.ledger_entries (account_id, kind, amount, lot_id, idempotency_key)
  values (p_account, p_entry_kind, p_amount, v_lot, p_key);
  if v_pay > 0 then
    update public.ledger_accounts set debt = debt - v_pay where id = p_account;
    insert into public.ledger_entries (account_id, kind, amount, lot_id, idempotency_key)
    values (p_account, 'debt-paid', v_pay, v_lot, p_key || ':debt');
  end if;
  return v_lot;
end $$;

-- Take `p_amount` from lots in lot order (earliest-expiring granted, then paid
-- oldest first); returns what was actually taken. Caller holds the lock.
create function public.ledger_take(p_account uuid, p_hold uuid, p_amount numeric)
returns numeric language plpgsql security definer set search_path = '' as $$
declare l record; v_left numeric := p_amount; v_take numeric;
begin
  for l in
    select id, remaining from public.credit_lots
     where account_id = p_account and remaining > 0 and (expires_at is null or expires_at > now())
     order by case when credit_kind = 'granted' then 0 else 1 end, expires_at nulls last, created_at
  loop
    exit when v_left <= 0;
    v_take := least(l.remaining, v_left);
    update public.credit_lots set remaining = remaining - v_take where id = l.id;
    insert into public.hold_lots (hold_id, lot_id, amount) values (p_hold, l.id, v_take)
    on conflict (hold_id, lot_id) do update set amount = public.hold_lots.amount + excluded.amount;
    v_left := v_left - v_take;
  end loop;
  return p_amount - v_left;
end $$;

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

-- Operator grants to a specific user.
create function public.ledger_grant(p_actor uuid, p_user uuid, p_amount numeric, p_expires timestamptz, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_grant uuid; v_acc uuid;
begin
  if not coalesce((select is_admin from public.profiles where id = p_actor), false) then
    raise exception 'Only the operator grants credit' using errcode = '42501';
  end if;
  insert into public.credit_grants (user_id, amount, expires_at, note, created_by)
  values (p_user, p_amount, p_expires, p_note, p_actor) returning id into v_grant;
  v_acc := public.ledger_user_account(p_user);
  perform 1 from public.ledger_accounts where id = v_acc for update;
  perform public.ledger_new_lot(v_acc, 'granted', 'grant:' || v_grant, p_amount, p_expires, 'grant', 'grant:' || v_grant);
  return v_grant;
end $$;

-- A paid top-up, idempotent by the payment event (called by the verified Stripe webhook).
create function public.ledger_topup(p_user uuid, p_amount numeric, p_event text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_acc uuid;
begin
  if p_amount <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  if exists (select 1 from public.ledger_entries where idempotency_key = 'top-up:' || p_event) then return; end if;
  v_acc := public.ledger_user_account(p_user);
  perform 1 from public.ledger_accounts where id = v_acc for update;
  perform public.ledger_new_lot(v_acc, 'paid', 'top-up:' || p_event, p_amount, null, 'top-up', 'top-up:' || p_event);
end $$;

-- hold: the payer comes from the job; the actor must be allowed to charge it.
create function public.ledger_hold(p_actor uuid, p_job uuid, p_estimate numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.ai_jobs; a public.ledger_accounts; v_hold uuid; v_free_margin numeric; v_margin numeric; v_got numeric;
begin
  if exists (select 1 from public.holds where job_id = p_job) then return; end if;  -- idempotent: hold:<job>
  if p_estimate <= 0 then raise exception 'bad estimate' using errcode = '22023'; end if;
  select * into j from public.ai_jobs where id = p_job;
  if not found or j.status <> 'running' then raise exception 'no running job' using errcode = '22023'; end if;
  select * into a from public.ledger_accounts where id = j.payer_account_id for update;
  -- Payer rules (ledger §9.5).
  if a.kind = 'user' then
    if j.kind = 'deputy-draft' then
      if public.course_role_of(j.package_id, p_actor) <> 'deputy'
         or public.course_role_of(j.package_id, a.user_id) <> 'owner' then
        raise exception 'This draft may not be charged to that account' using errcode = '42501';
      end if;
    elsif a.user_id is distinct from p_actor then
      raise exception 'A job is paid by the person who asked' using errcode = '42501';
    end if;
  elsif a.kind = 'course-allowance' then
    if j.kind not in ('automatic', 'checkpoint') or a.package_id is distinct from j.package_id
       or public.course_role_of(j.package_id, p_actor) is null then
      raise exception 'The course allowance pays only automatic work of its course' using errcode = '42501';
    end if;
    if a.month < date_trunc('month', now())::date then
      raise exception 'That month''s allowance has ended' using errcode = '42501';
    end if;
    -- While the owner has debt (e.g. a disputed payment), the allowance can't be spent (ledger §9.4).
    if exists (select 1 from public.course_members m join public.ledger_accounts u on u.kind = 'user' and u.user_id = m.user_id
                where m.package_id = a.package_id and m.role = 'owner' and u.debt > 0) then
      raise exception 'The course allowance is paused until the owner''s balance is cleared' using errcode = '42501';
    end if;
  elsif a.kind = 'demo-budget' then
    if j.kind <> 'try' then raise exception 'The demo budget pays only try mode' using errcode = '42501'; end if;
  else
    raise exception 'unsupported payer' using errcode = '22023';
  end if;
  if a.debt > 0 then raise exception 'Clear the outstanding balance first' using errcode = '42501'; end if;
  if public.ledger_balance(a.id) < p_estimate then
    raise exception 'Not enough credit' using errcode = '53400';
  end if;
  v_free_margin := greatest(0, 5 - coalesce((select sum(margin) from public.holds where account_id = a.id and status = 'open'), 0));
  v_margin := least(greatest(p_estimate * 0.10, 1), v_free_margin);
  insert into public.holds (job_id, account_id, margin) values (p_job, a.id, v_margin) returning id into v_hold;
  v_got := public.ledger_take(a.id, v_hold, p_estimate);
  update public.holds set drawn = v_got where id = v_hold;
  insert into public.ledger_entries (account_id, kind, amount, job_id, idempotency_key)
  values (a.id, 'hold', v_got, p_job, 'hold:' || p_job);
end $$;

-- extend: draw more into an open hold; false if there isn't enough credit.
create function public.ledger_extend(p_job uuid, p_more numeric, p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare h public.holds; v_got numeric;
begin
  if exists (select 1 from public.ledger_entries where idempotency_key = 'extend:' || p_job || ':' || p_key) then return true; end if;
  select * into h from public.holds where job_id = p_job and status = 'open';
  if not found then return false; end if;
  perform 1 from public.ledger_accounts where id = h.account_id for update;
  if public.ledger_balance(h.account_id) < p_more then return false; end if;
  v_got := public.ledger_take(h.account_id, h.id, p_more);
  update public.holds set drawn = drawn + v_got where id = h.id;
  insert into public.ledger_entries (account_id, kind, amount, job_id, idempotency_key)
  values (h.account_id, 'hold', v_got, p_job, 'extend:' || p_job || ':' || p_key);
  return true;
end $$;

-- capture: spending against the job's hold; anything beyond what was drawn
-- goes straight to debt (the margin is a limit, never money). Returns true
-- while the job is within drawn + margin, false once it is past it (the
-- orchestrator then extends or stops the job).
create function public.ledger_capture(p_job uuid, p_call text, p_cost numeric)
returns boolean language plpgsql security definer set search_path = '' as $$
declare h public.holds; v_cost numeric := ceil(p_cost * 10000) / 10000; v_prev numeric; v_over numeric;
begin
  if v_cost < 0 then raise exception 'bad cost' using errcode = '22023'; end if;
  select amount into v_prev from public.ledger_entries where idempotency_key = 'capture:' || p_job || ':' || p_call;
  if found then
    if v_prev <> v_cost then raise warning 'capture % for job % repeated with a different cost (% vs %)', p_call, p_job, v_prev, v_cost; end if;
    select * into h from public.holds where job_id = p_job;
    return h.captured <= h.drawn + h.margin;
  end if;
  select * into h from public.holds where job_id = p_job;
  if not found then raise exception 'no hold for this job' using errcode = '22023'; end if;
  perform 1 from public.ledger_accounts where id = h.account_id for update;
  select * into h from public.holds where id = h.id;
  if h.status = 'open' then
    v_over := greatest(0, (h.captured + v_cost) - h.drawn) - greatest(0, h.captured - h.drawn);
  else
    v_over := v_cost;  -- late usage after release: all of it is charged
  end if;
  update public.holds set captured = captured + v_cost where id = h.id;
  insert into public.ledger_entries (account_id, kind, amount, job_id, idempotency_key)
  values (h.account_id, 'capture', v_cost, p_job, 'capture:' || p_job || ':' || p_call);
  if v_over > 0 then
    update public.ledger_accounts set debt = debt + v_over where id = h.account_id;
    insert into public.ledger_entries (account_id, kind, amount, job_id, idempotency_key)
    values (h.account_id, 'overrun', v_over, p_job, 'overrun:' || p_job || ':' || p_call);
  end if;
  return h.captured + v_cost <= h.drawn + h.margin;
end $$;

-- release: return drawn − captured to the hold's lots (latest lot first);
-- an expired lot keeps nothing (the returned part expires at once).
create function public.ledger_release(p_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.holds; v_back numeric; hl record; v_put numeric;
begin
  select * into h from public.holds where job_id = p_job;
  if not found or h.status = 'released' then return; end if;  -- idempotent: release:<job>
  perform 1 from public.ledger_accounts where id = h.account_id for update;
  select * into h from public.holds where id = h.id;
  if h.status = 'released' then return; end if;
  v_back := greatest(0, h.drawn - h.captured);
  for hl in
    select x.lot_id, x.amount, l.expires_at, l.credit_kind
      from public.hold_lots x join public.credit_lots l on l.id = x.lot_id
     where x.hold_id = h.id
     order by case when l.credit_kind = 'granted' then 1 else 0 end, l.expires_at desc nulls first, l.created_at desc
  loop
    exit when v_back <= 0;
    v_put := least(hl.amount, v_back);
    if hl.expires_at is null or hl.expires_at > now() then
      update public.credit_lots set remaining = remaining + v_put where id = hl.lot_id;
    else
      insert into public.ledger_entries (account_id, kind, amount, lot_id, job_id, idempotency_key)
      values (h.account_id, 'expiry', v_put, hl.lot_id, p_job, 'expiry:release:' || p_job || ':' || hl.lot_id);
    end if;
    v_back := v_back - v_put;
  end loop;
  update public.holds set status = 'released' where id = h.id;
  insert into public.ledger_entries (account_id, kind, amount, job_id, idempotency_key)
  values (h.account_id, 'release', greatest(0, h.drawn - h.captured), p_job, 'release:' || p_job);
end $$;

-- refund (platform fault): returns the captured cost of one call; never
-- changes `captured`, so release can't return it twice. The part that went
-- to debt reduces debt first; the rest becomes a paid lot.
create function public.ledger_refund(p_job uuid, p_call text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.holds; v_cost numeric; v_over numeric; v_lot numeric;
begin
  if exists (select 1 from public.ledger_entries where idempotency_key = 'refund:' || p_job || ':' || p_call) then return; end if;
  select amount into v_cost from public.ledger_entries where idempotency_key = 'capture:' || p_job || ':' || p_call;
  if not found then raise exception 'nothing captured for that call' using errcode = '22023'; end if;
  select * into h from public.holds where job_id = p_job;
  perform 1 from public.ledger_accounts where id = h.account_id for update;
  v_over := coalesce((select amount from public.ledger_entries where idempotency_key = 'overrun:' || p_job || ':' || p_call), 0);
  v_over := least(v_over, (select debt from public.ledger_accounts where id = h.account_id));
  update public.ledger_accounts set debt = debt - v_over where id = h.account_id;
  -- `captured` is never lowered (that would let release return the same
  -- credit twice); the refunded part comes back as a new paid lot.
  v_lot := v_cost - v_over;
  if v_lot > 0 then
    insert into public.credit_lots (account_id, credit_kind, source, remaining)
    values (h.account_id, 'paid', 'refund:' || p_job || ':' || p_call, v_lot);
  end if;
  insert into public.ledger_entries (account_id, kind, amount, job_id, idempotency_key, note)
  values (h.account_id, 'refund', v_cost, p_job, 'refund:' || p_job || ':' || p_call, p_reason);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'ledger_user_account(uuid)', 'ledger_balance(uuid)',
    'ledger_new_lot(uuid, text, text, numeric, timestamptz, text, text)', 'ledger_take(uuid, uuid, numeric)',
    'ledger_grant(uuid, uuid, numeric, timestamptz, text)', 'ledger_topup(uuid, numeric, text)',
    'ledger_hold(uuid, uuid, numeric)', 'ledger_extend(uuid, numeric, text)', 'ledger_capture(uuid, text, numeric)',
    'ledger_release(uuid)', 'ledger_refund(uuid, text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
