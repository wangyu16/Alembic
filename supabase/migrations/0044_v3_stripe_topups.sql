-- 0044: Stripe top-ups (workspace v3, E5; ledger-v3 §3.2, §7, L-12).
--
-- credit_prices: the operator-set price of one credit, versioned. A checkout
-- records the price in force when it was created; the payment and any later
-- refund or dispute convert with that price. stripe_checkouts: one row per
-- Checkout Session Alembic created; the user comes from this row (set by the
-- server when the session was made), never from the webhook payload.
--
-- Refunds and disputes are tracked as the STATE of a payment, not as deltas:
-- stripe_payments holds Stripe's running refund total and the disputes whose
-- money was withdrawn (and not reinstated). After every event the credit is
-- reconciled to "paid − refunded − withdrawn", so order, retries and a refund
-- that arrives before the payment is recorded all end in the same place, and
-- a won dispute gives the credit back.
-- stripe_problems: paid events Alembic could not match (amount, user, mode),
-- kept for the operator instead of only a log line.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0043.

create table public.credit_prices (
  version        serial primary key,
  usd_per_credit numeric not null check (usd_per_credit > 0),
  valid_from     timestamptz not null default now()
);

create table public.stripe_checkouts (
  session_id     text primary key,
  user_id        uuid not null references public.profiles (id),
  price_version  int not null references public.credit_prices (version),
  usd_cents      int not null check (usd_cents > 0),
  credits        numeric(14,4) not null check (credits > 0),
  payment_intent text unique,
  topup_event    text,               -- the Stripe event that credited it (null = not paid yet)
  applied_cents  int not null default 0 check (applied_cents >= 0 and applied_cents <= usd_cents),  -- reversed so far
  adjustments    int not null default 0,
  created_at     timestamptz not null default now()
);

create table public.stripe_payments (
  payment_intent text primary key,
  refunded_cents int not null default 0 check (refunded_cents >= 0),
  updated_at     timestamptz not null default now()
);

create table public.stripe_disputes (
  dispute_id     text primary key,
  payment_intent text not null,
  amount_cents   int not null check (amount_cents >= 0),
  withdrawn      boolean not null,
  updated_at     timestamptz not null default now()
);

create table public.stripe_problems (
  event_id   text primary key,
  reason     text not null,
  at         timestamptz not null default now()
);

alter table public.credit_prices enable row level security;
alter table public.stripe_checkouts enable row level security;
alter table public.stripe_payments enable row level security;
alter table public.stripe_disputes enable row level security;
alter table public.stripe_problems enable row level security;
revoke all on public.credit_prices, public.stripe_checkouts, public.stripe_payments, public.stripe_disputes, public.stripe_problems from anon, authenticated;
grant select on public.credit_prices, public.stripe_checkouts to authenticated;
create policy "anyone signed in reads prices" on public.credit_prices for select to authenticated using (true);
create policy "own checkouts" on public.stripe_checkouts for select to authenticated using (user_id = (select auth.uid()));

-- Record a new checkout at the price in force now. Called right after the
-- server created the Checkout Session (client_reference_id = p_user).
create function public.ledger_checkout_created(p_session text, p_user uuid, p_usd_cents int)
returns numeric language plpgsql security definer set search_path = '' as $$
declare p public.credit_prices; v_credits numeric;
begin
  select * into p from public.credit_prices where valid_from <= now() order by valid_from desc, version desc limit 1;
  if not found then raise exception 'No credit price is set' using errcode = '22023'; end if;
  if p_usd_cents <= 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  v_credits := round((p_usd_cents / 100.0) / p.usd_per_credit, 4);  -- the ledger's own precision: no rounding dust
  insert into public.stripe_checkouts (session_id, user_id, price_version, usd_cents, credits)
  values (p_session, p_user, p.version, p_usd_cents, v_credits)
  on conflict (session_id) do nothing;
  return v_credits;
end $$;

-- Bring a credited checkout's credit in line with its payment's state.
create function public.ledger_reconcile_payment(p_payment_intent text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.stripe_checkouts; v_target int; v_amount numeric; v_key text;
begin
  select * into c from public.stripe_checkouts where payment_intent = p_payment_intent for update;
  if not found or c.topup_event is null then return; end if;  -- not ours, or not credited yet: applied when it is
  v_target := least(c.usd_cents,
    coalesce((select refunded_cents from public.stripe_payments where payment_intent = p_payment_intent), 0)
    + coalesce((select sum(amount_cents) from public.stripe_disputes where payment_intent = p_payment_intent and withdrawn), 0));
  if v_target = c.applied_cents then return; end if;
  -- Telescoping, so the pieces of a full reversal add up to exactly c.credits.
  v_amount := round(c.credits * v_target / c.usd_cents, 4) - round(c.credits * c.applied_cents / c.usd_cents, 4);
  v_key := c.session_id || ':' || (c.adjustments + 1);
  update public.stripe_checkouts set applied_cents = v_target, adjustments = adjustments + 1 where session_id = c.session_id;
  if v_amount > 0 then
    perform public.ledger_topup_reversed(c.topup_event, v_amount, v_key);
  elsif v_amount < 0 then
    -- Money came back to Alembic (a dispute won): the credit comes back, paying any debt first.
    perform 1 from public.ledger_accounts where id = public.ledger_user_account(c.user_id) for update;
    perform public.ledger_new_lot(public.ledger_user_account(c.user_id), 'paid', 'restore:' || v_key, -v_amount, null, 'top-up', 'restore:' || v_key);
  end if;
end $$;

-- A paid checkout: credit the user once per session, whatever event says so.
-- The amount and the user must match what was recorded at creation.
create function public.ledger_checkout_paid(p_session text, p_event text, p_payment_intent text, p_usd_cents int, p_reference uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.stripe_checkouts;
begin
  select * into c from public.stripe_checkouts where session_id = p_session for update;
  if not found then raise exception 'unknown checkout' using errcode = 'P0002'; end if;  -- retryable: may not be recorded yet
  if c.topup_event is not null then return; end if;  -- already credited (by this or another event)
  if p_reference is distinct from c.user_id then raise exception 'checkout belongs to someone else' using errcode = '42501'; end if;
  if p_usd_cents <> c.usd_cents then raise exception 'paid amount differs from the checkout' using errcode = '22023'; end if;
  if p_payment_intent is null then raise exception 'paid checkout without a payment' using errcode = '22023'; end if;
  update public.stripe_checkouts set topup_event = p_event, payment_intent = p_payment_intent where session_id = p_session;
  perform public.ledger_topup(c.user_id, c.credits, p_event);
  perform public.ledger_reconcile_payment(p_payment_intent);  -- a refund may have arrived first
end $$;

-- charge.refunded: Stripe's running refund total for the payment.
create function public.ledger_payment_refunded(p_payment_intent text, p_total_cents int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_total_cents < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  insert into public.stripe_payments (payment_intent, refunded_cents) values (p_payment_intent, p_total_cents)
  on conflict (payment_intent) do update
    set refunded_cents = greatest(public.stripe_payments.refunded_cents, excluded.refunded_cents), updated_at = now();
  perform public.ledger_reconcile_payment(p_payment_intent);
end $$;

-- charge.dispute.funds_withdrawn / funds_reinstated. Inquiries and warnings
-- move no money and are not passed here.
create function public.ledger_payment_dispute(p_payment_intent text, p_dispute text, p_amount_cents int, p_withdrawn boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_amount_cents < 0 then raise exception 'bad amount' using errcode = '22023'; end if;
  insert into public.stripe_disputes (dispute_id, payment_intent, amount_cents, withdrawn) values (p_dispute, p_payment_intent, p_amount_cents, p_withdrawn)
  on conflict (dispute_id) do update set withdrawn = excluded.withdrawn, amount_cents = excluded.amount_cents, updated_at = now()
    where public.stripe_disputes.payment_intent = excluded.payment_intent;
  perform public.ledger_reconcile_payment(p_payment_intent);
end $$;

create function public.ledger_stripe_problem(p_event text, p_reason text)
returns void language sql security definer set search_path = '' as $$
  insert into public.stripe_problems (event_id, reason) values (p_event, left(p_reason, 500)) on conflict (event_id) do nothing;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ledger_checkout_created(text, uuid, int)', 'ledger_reconcile_payment(text)',
    'ledger_checkout_paid(text, text, text, int, uuid)', 'ledger_payment_refunded(text, int)',
    'ledger_payment_dispute(text, text, int, boolean)', 'ledger_stripe_problem(text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
