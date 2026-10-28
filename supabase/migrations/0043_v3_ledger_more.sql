-- 0043: the ledger's remaining rules (workspace v3, C1) — cohorts, the course
-- allowance (fund, month-end return), and Stripe refunds/disputes that
-- follow transferred credit (ledger-v3 §3.1, §3.2, §3.3, §9.4, §9.7, §9.8).
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0039.

create table public.cohorts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create table public.cohort_members (
  cohort_id uuid not null references public.cohorts (id) on delete cascade,
  user_id   uuid not null references public.profiles (id),
  added_by  uuid not null references public.profiles (id),
  added_at  timestamptz not null default now(),
  primary key (cohort_id, user_id)
);
alter table public.credit_grants add column cohort_id uuid references public.cohorts (id);
alter table public.credit_grants alter column user_id drop not null;
alter table public.credit_grants add constraint credit_grants_target check ((user_id is null) <> (cohort_id is null));

-- Where transferred credit came from, so a refunded top-up can be followed into an allowance.
create table public.lot_origins (
  lot_id        uuid not null references public.credit_lots (id),
  source_lot_id uuid not null references public.credit_lots (id),
  amount        numeric(14,4) not null check (amount >= 0),  -- what of it can still be taken back
  primary key (lot_id, source_lot_id)
);

do $$
declare t text;
begin
  foreach t in array array['cohorts','cohort_members','lot_origins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Owners may read their courses' allowance accounts, lots and entries.
create policy "owner reads allowance" on public.ledger_accounts for select to authenticated
  using (kind = 'course-allowance' and public.course_role(package_id) = 'owner');
create policy "owner reads allowance lots" on public.credit_lots for select to authenticated
  using (exists (select 1 from public.ledger_accounts a where a.id = account_id and a.kind = 'course-allowance' and public.course_role(a.package_id) = 'owner'));

-- ---------------------------------------------------------------------------
-- Cohorts: per-member grants, created when the member is added (operator only).
-- ---------------------------------------------------------------------------
create function public.ledger_cohort_grant(p_actor uuid, p_cohort uuid, p_amount numeric, p_expires timestamptz, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_grant uuid; m record;
begin
  if p_expires is not null and p_expires <= now() then raise exception 'That expiry date has passed' using errcode = '22023'; end if;
  if not coalesce((select is_admin from public.profiles where id = p_actor), false) then
    raise exception 'Only the operator grants credit' using errcode = '42501';
  end if;
  insert into public.credit_grants (cohort_id, amount, expires_at, note, created_by)
  values (p_cohort, p_amount, p_expires, p_note, p_actor) returning id into v_grant;
  for m in select user_id from public.cohort_members where cohort_id = p_cohort loop
    perform public.ledger_cohort_member_lot(v_grant, m.user_id);
  end loop;
  return v_grant;
end $$;

create function public.ledger_cohort_member_lot(p_grant uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.credit_grants; v_acc uuid;
begin
  select * into g from public.credit_grants where id = p_grant;
  if g.ended_at is not null or (g.expires_at is not null and g.expires_at <= now()) then return; end if;
  if exists (select 1 from public.ledger_entries where idempotency_key = 'grant:' || p_grant || ':' || p_user) then return; end if;
  v_acc := public.ledger_user_account(p_user);
  perform 1 from public.ledger_accounts where id = v_acc for update;
  perform public.ledger_new_lot(v_acc, 'granted', 'grant:' || p_grant || ':' || p_user, g.amount, g.expires_at, 'grant', 'grant:' || p_grant || ':' || p_user);
end $$;

create function public.ledger_cohort_add(p_actor uuid, p_cohort uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  if not coalesce((select is_admin from public.profiles where id = p_actor), false) then
    raise exception 'Only the operator adds cohort members' using errcode = '42501';
  end if;
  insert into public.cohort_members (cohort_id, user_id, added_by) values (p_cohort, p_user, p_actor)
  on conflict do nothing;
  for g in select id from public.credit_grants where cohort_id = p_cohort loop
    perform public.ledger_cohort_member_lot(g.id, p_user);  -- once per (grant, user): leave + rejoin gives nothing more
  end loop;
end $$;

-- Ending a grant expires its unused lots at once (spent credit is never clawed back).
create function public.ledger_end_grant(p_actor uuid, p_grant uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  if not coalesce((select is_admin from public.profiles where id = p_actor), false) then
    raise exception 'Only the operator ends grants' using errcode = '42501';
  end if;
  update public.credit_grants set ended_at = now() where id = p_grant and ended_at is null;
  for l in select id, account_id, remaining from public.credit_lots
            where (source = 'grant:' || p_grant or source like 'grant:' || p_grant || ':%') and remaining > 0 loop
    perform 1 from public.ledger_accounts where id = l.account_id for update;
    update public.credit_lots set remaining = 0, expires_at = now() where id = l.id;
    insert into public.ledger_entries (account_id, kind, amount, lot_id, idempotency_key)
    values (l.account_id, 'expiry', l.remaining, l.id, 'expiry:end:' || l.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Course allowance: paid credit only, origin recorded; month-end return.
-- ---------------------------------------------------------------------------
create function public.ledger_fund_allowance(p_actor uuid, p_package text, p_month date, p_amount numeric, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := p_actor; v_from uuid; v_to uuid; v_left numeric := p_amount; l record; v_take numeric; v_lot uuid;
begin
  if public.course_role_of(p_package, p_actor) is distinct from 'owner' then
    raise exception 'Only the owner funds the course allowance' using errcode = '42501';
  end if;
  if exists (select 1 from public.ledger_entries where idempotency_key = 'transfer-out:' || p_key) then return; end if;
  v_from := public.ledger_user_account(v_owner);
  if date_trunc('month', p_month) < date_trunc('month', now()) then
    raise exception 'That month has ended' using errcode = '22023';
  end if;
  insert into public.ledger_accounts (kind, package_id, month) values ('course-allowance', p_package, date_trunc('month', p_month)::date)
  on conflict (package_id, month) where kind = 'course-allowance' do nothing;
  select id into v_to from public.ledger_accounts where kind = 'course-allowance' and package_id = p_package and month = date_trunc('month', p_month)::date;
  -- Lock both accounts in a fixed order.
  perform 1 from public.ledger_accounts where id in (v_from, v_to) order by id for update;
  if (select debt from public.ledger_accounts where id = v_from) > 0 then
    raise exception 'Clear the outstanding balance first' using errcode = '42501';
  end if;
  if coalesce((select sum(remaining) from public.credit_lots where account_id = v_from and credit_kind = 'paid'), 0) < p_amount then
    raise exception 'The allowance is funded from paid credit only, and there isn''t enough' using errcode = '53400';
  end if;
  insert into public.credit_lots (account_id, credit_kind, source, remaining)
  values (v_to, 'paid', 'transfer:' || p_key, p_amount) returning id into v_lot;
  for l in select id, remaining from public.credit_lots where account_id = v_from and credit_kind = 'paid' and remaining > 0 order by created_at loop
    exit when v_left <= 0;
    v_take := least(l.remaining, v_left);
    update public.credit_lots set remaining = remaining - v_take where id = l.id;
    insert into public.lot_origins (lot_id, source_lot_id, amount) values (v_lot, l.id, v_take);
    v_left := v_left - v_take;
  end loop;
  insert into public.ledger_entries (account_id, kind, amount, idempotency_key) values (v_from, 'transfer-out', p_amount, 'transfer-out:' || p_key);
  insert into public.ledger_entries (account_id, kind, amount, lot_id, idempotency_key) values (v_to, 'transfer-in', p_amount, v_lot, 'transfer-in:' || p_key);
end $$;

-- Month-end: the unused allowance goes back to the course's owner as paid credit (idempotent).
create function public.ledger_allowance_return(p_package text, p_month date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_acc uuid; v_owner uuid; v_back numeric;
begin
  p_month := date_trunc('month', p_month)::date;  -- one key per month, whatever day is passed
  select id into v_acc from public.ledger_accounts where kind = 'course-allowance' and package_id = p_package and month = date_trunc('month', p_month)::date;
  if v_acc is null then return; end if;
  if exists (select 1 from public.ledger_entries where idempotency_key = 'return:' || p_package || ':' || p_month) then return; end if;
  select user_id into v_owner from public.course_members where package_id = p_package and role = 'owner';
  perform 1 from public.ledger_accounts where id = v_acc for update;
  v_back := coalesce((select sum(remaining) from public.credit_lots where account_id = v_acc), 0);
  update public.credit_lots set remaining = 0 where account_id = v_acc;
  insert into public.ledger_entries (account_id, kind, amount, idempotency_key) values (v_acc, 'transfer-out', v_back, 'return:' || p_package || ':' || p_month);
  if v_back > 0 then
    perform public.ledger_new_lot(public.ledger_user_account(v_owner), 'paid', 'return:' || p_package || ':' || p_month, v_back, null, 'transfer-in', 'return-in:' || p_package || ':' || p_month);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Stripe refund/dispute: take the credit back from the unused part of any
-- allowance it funded, then from the top-up lot, then to the owner's debt (§9.4).
-- ---------------------------------------------------------------------------
create function public.ledger_topup_reversed(p_event text, p_amount numeric, p_reason_event text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_lot uuid; v_acc uuid; l public.credit_lots; v_left numeric := p_amount; v_take numeric; o record;
begin
  if exists (select 1 from public.ledger_entries where idempotency_key = 'reversal:' || p_reason_event) then return; end if;
  select id, account_id into v_lot, v_acc from public.credit_lots where source = 'top-up:' || p_event;
  if not found then raise exception 'unknown top-up' using errcode = '22023'; end if;
  perform 1 from public.ledger_accounts where id = v_acc for update;  -- lock, then read the lot
  select * into l from public.credit_lots where id = v_lot;
  -- Order (ledger §9.4): the unused part of any allowance it funded, then the top-up lot, then debt.
  for o in select x.lot_id, x.amount, c.account_id from public.lot_origins x join public.credit_lots c on c.id = x.lot_id
            where x.source_lot_id = l.id and x.amount > 0 order by c.account_id loop
    exit when v_left <= 0;
    perform 1 from public.ledger_accounts where id = o.account_id for update;
    v_take := least(o.amount, (select remaining from public.credit_lots where id = o.lot_id), v_left);
    if v_take > 0 then
      update public.credit_lots set remaining = remaining - v_take where id = o.lot_id;
      update public.lot_origins set amount = amount - v_take where lot_id = o.lot_id and source_lot_id = l.id;
      insert into public.ledger_entries (account_id, kind, amount, lot_id, idempotency_key, note)
      values (o.account_id, 'refund', v_take, o.lot_id, 'reversal:' || p_reason_event || ':' || o.lot_id, 'funding payment refunded or disputed');
      v_left := v_left - v_take;
    end if;
  end loop;
  v_take := least(l.remaining, v_left);
  update public.credit_lots set remaining = remaining - v_take where id = l.id;
  v_left := v_left - v_take;
  if v_left > 0 then update public.ledger_accounts set debt = debt + v_left where id = l.account_id; end if;
  insert into public.ledger_entries (account_id, kind, amount, lot_id, idempotency_key, note)
  values (l.account_id, 'refund', p_amount, l.id, 'reversal:' || p_reason_event, 'payment refunded or disputed');
end $$;

-- Holds on an allowance are refused while its owner has debt (ledger §9.4).
create or replace function public.ledger_owner_in_debt(p_package text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.debt > 0 from public.course_members m
                    join public.ledger_accounts a on a.kind = 'user' and a.user_id = m.user_id
                   where m.package_id = p_package and m.role = 'owner'), false)
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ledger_cohort_grant(uuid, uuid, numeric, timestamptz, text)', 'ledger_cohort_member_lot(uuid, uuid)',
    'ledger_cohort_add(uuid, uuid, uuid)', 'ledger_end_grant(uuid, uuid)',
    'ledger_fund_allowance(uuid, text, date, numeric, text)', 'ledger_allowance_return(text, date)',
    'ledger_topup_reversed(text, numeric, text)', 'ledger_owner_in_debt(text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
