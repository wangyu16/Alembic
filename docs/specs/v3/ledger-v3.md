# AI credit ledger (v3) — mini-spec

**Status:** draft for gate G7, 2026-10-27. Module C1. Design source:
`ALEMBIC-WORKSPACE-DESIGN.md` §11 (payer of record, course allowance, holds,
credit kinds), rulings R9, R27 (Stripe top-ups + operator grants to specific
users or cohorts), O7.

## 1. Accounts and entries

```sql
create table public.ledger_accounts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('user', 'course-allowance', 'demo-budget')),
  user_id    uuid references public.profiles(id),
  package_id text references public.packages(id),
  month      date,                              -- course-allowance and demo-budget: the month it covers
  unique (kind, user_id, package_id, month)
);

create table public.ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.ledger_accounts(id),
  kind            text not null check (kind in ('grant','top-up','transfer-in','transfer-out','hold','capture','release','expiry','refund')),
  credit_kind     text not null check (credit_kind in ('granted','paid')),
  amount          numeric(14,4) not null check (amount > 0),  -- always positive; kind gives the sign
  job_id          uuid,
  grant_id        uuid,
  idempotency_key text not null unique,
  note            text,
  created_at      timestamptz not null default now()
);

create table public.credit_grants (
  id         uuid primary key default gen_random_uuid(),
  target     text not null check (target in ('user','cohort')),
  user_id    uuid references public.profiles(id),
  cohort_id  uuid,                    -- a workshop cohort
  amount     numeric(14,4) not null,
  expires_at timestamptz,
  note       text,                    -- e.g. "pilot, Fall 2026"
  created_by uuid not null,           -- operator
  ended_at   timestamptz
);
```

- **Append-only.** No updates or deletes on `ledger_entries` by anyone,
  the service role included (revoked; a correction is a new entry).
- **Balances are sums.** Per account and credit kind:
  `available = grants + top-ups + transfers-in + releases + refunds
  − holds − transfers-out − expiries`. Captures don't change the balance;
  they convert part of a hold into spending. The hold's unused part is
  released.

## 2. Operations (definer functions, service role only)

| Function | Effect |
|---|---|
| `credit_grant(grant)` | `grant` entry(ies) on the user's account, or on each cohort member's account as they join; with expiry |
| `credit_topup(user, amount, stripe_event_id)` | `top-up` entry, `paid`; idempotent by the Stripe event id |
| `fund_allowance(owner, package, month, amount)` | `transfer-out` from the owner, `transfer-in` to the course allowance; owner only |
| `hold(payer_account, job, estimate)` | splits into **granted first, then paid** (one entry per kind); refuses if available < estimate (**fail closed**) |
| `capture(job, call_id, cost)` | records spending against the job's hold, idempotent by call id; may exceed the hold by at most the **step margin** (10% or 1 credit, whichever is larger), recorded as a `capture` beyond the hold |
| `release(job)` | releases the unused hold when the job ends |
| `refund(job, reason)` | platform faults: reverses captures of the faulty step (design §11.2) |
| `expire_grants()` | scheduled: `expiry` entries for expired, unused granted credit |

## 3. Who pays (design §11.2)

- `jobs.payer_account_id` is set when the job starts:
  - the requester's user account for requests;
  - the course allowance for automatic work and checkpoints;
  - for a deputy's "approve and draft materials", the owner's account if
    the owner has turned that option on;
  - the demo budget for try mode.
- Quick asks hold and capture on the asker's account.

## 4. Gateway coupling

- One gateway key per job, with a budget equal to the hold plus the step
  margin. The gateway's usage callback calls `capture` (idempotent by call
  id).
- A key whose budget is exhausted stops; the job pauses at a safe point
  (design §8.7).

## 5. Claims

| Claim | What |
|---|---|
| L.1 | entries are append-only: no update or delete for any role |
| L.2 | the balance equals the sum rule for every generated sequence of operations (property test) |
| L.3 | a hold never takes more than is available (fail closed); granted credit is used before paid |
| L.4 | a capture is idempotent by call id; total spending ≤ hold + step margin |
| L.5 | releasing returns exactly the unused hold |
| L.6 | expiry removes only unused granted credit; paid credit never expires |
| L.7 | Stripe top-ups are idempotent by event id |
| L.8 | only the owner funds a course allowance; only the operator grants |
| L.9 | one payer's exhaustion doesn't affect another payer's jobs |
