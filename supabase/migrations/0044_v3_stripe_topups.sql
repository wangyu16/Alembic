-- 0044: Stripe top-ups (workspace v3, E5; ledger-v3 §3.2, §7, L-12).
--
-- credit_prices: the operator-set price of one credit, versioned. A checkout
-- records the price in force when it was created, and the payment and any
-- refund or dispute convert with that price. stripe_checkouts: one row per
-- Checkout Session Alembic created; the user comes from this row (set by the
-- server when the session was made), never from the webhook payload.
-- All service-role only; members read nothing here except their own checkouts.
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
  credits        numeric not null check (credits > 0),
  payment_intent text unique,
  topup_event    text,               -- the Stripe event that credited it (null = not paid yet)
  reversed_cents int not null default 0 check (reversed_cents >= 0 and reversed_cents <= usd_cents),
  created_at     timestamptz not null default now()
);

alter table public.credit_prices enable row level security;
alter table public.stripe_checkouts enable row level security;
revoke all on public.credit_prices, public.stripe_checkouts from anon, authenticated;
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
  v_credits := round((p_usd_cents / 100.0) / p.usd_per_credit, 6);
  insert into public.stripe_checkouts (session_id, user_id, price_version, usd_cents, credits)
  values (p_session, p_user, p.version, p_usd_cents, v_credits)
  on conflict (session_id) do nothing;
  return v_credits;
end $$;

-- A paid checkout: credit the user once per session, whatever event says so.
-- The amount must match what was recorded at creation.
create function public.ledger_checkout_paid(p_session text, p_event text, p_payment_intent text, p_usd_cents int, p_reference uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.stripe_checkouts;
begin
  select * into c from public.stripe_checkouts where session_id = p_session for update;
  if not found then raise exception 'unknown checkout' using errcode = 'P0002'; end if;  -- retryable
  if c.topup_event is not null then return; end if;  -- already credited (by this or another event)
  if p_reference is distinct from c.user_id then raise exception 'checkout belongs to someone else' using errcode = '42501'; end if;
  if p_usd_cents <> c.usd_cents then raise exception 'paid amount differs from the checkout' using errcode = '22023'; end if;
  update public.stripe_checkouts set topup_event = p_event, payment_intent = p_payment_intent where session_id = p_session;
  perform public.ledger_topup(c.user_id, c.credits, p_event);
end $$;

-- A refund or dispute on a paid checkout. p_total_cents is Stripe's running
-- total for refunds (charge.amount_refunded); for a dispute pass p_add_cents.
-- Only the part not reversed before is taken back, at the checkout's price.
create function public.ledger_payment_reversed(p_payment_intent text, p_reason_event text, p_total_cents int, p_add_cents int)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.stripe_checkouts; v_new int; v_delta int;
begin
  select * into c from public.stripe_checkouts where payment_intent = p_payment_intent for update;
  if not found or c.topup_event is null then raise exception 'unknown paid checkout' using errcode = '22023'; end if;  -- not ours, or never credited: logged, not retried
  if exists (select 1 from public.ledger_entries where idempotency_key = 'reversal:' || p_reason_event) then return; end if;
  v_new := least(c.usd_cents, greatest(c.reversed_cents, coalesce(p_total_cents, c.reversed_cents + coalesce(p_add_cents, 0))));
  v_delta := v_new - c.reversed_cents;
  if v_delta <= 0 then return; end if;
  update public.stripe_checkouts set reversed_cents = v_new where session_id = c.session_id;
  -- Telescoping difference, so the pieces of a full refund add up to exactly c.credits.
  perform public.ledger_topup_reversed(c.topup_event,
    round(c.credits * v_new / c.usd_cents, 6) - round(c.credits * c.reversed_cents / c.usd_cents, 6), p_reason_event);
end $$;

revoke execute on function public.ledger_checkout_created(text, uuid, int) from public, anon, authenticated;
revoke execute on function public.ledger_checkout_paid(text, text, text, int, uuid) from public, anon, authenticated;
revoke execute on function public.ledger_payment_reversed(text, text, int, int) from public, anon, authenticated;
grant execute on function public.ledger_checkout_created(text, uuid, int) to service_role;
grant execute on function public.ledger_checkout_paid(text, text, text, int, uuid) to service_role;
grant execute on function public.ledger_payment_reversed(text, text, int, int) to service_role;
