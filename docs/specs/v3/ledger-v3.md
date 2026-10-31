# AI credit ledger (v3) — mini-spec

**Status:** draft 3 for gate G7, 2026-10-27 (two review rounds; resolutions
§8 and §9). Module C1. Design source: `ALEMBIC-WORKSPACE-DESIGN.md` §11; rulings
R9, R27 (Stripe top-ups and operator grants to specific users or cohorts),
O7.

## 1. Model: accounts, lots, holds

Credit is held in **lots**. Every operation locks the account row, so
concurrent operations on one account are serialised (L-1).

```sql
create table public.ledger_accounts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('user','course-allowance','demo-budget','cohort-pool')),
  user_id    uuid references public.profiles(id),
  package_id text references public.packages(id),
  month      date,
  check ((kind = 'user' and user_id is not null and package_id is null and month is null)
      or (kind = 'course-allowance' and package_id is not null and month is not null and user_id is null)
      or (kind = 'demo-budget' and month is not null and user_id is null and package_id is null)
      or (kind = 'cohort-pool' and user_id is null and package_id is null and month is null)),
  debt       numeric(14,4) not null default 0 check (debt >= 0)   -- overruns not covered by any lot (§3.4)
);
create unique index on public.ledger_accounts (user_id) where kind = 'user';
create unique index on public.ledger_accounts (package_id, month) where kind = 'course-allowance';
create unique index on public.ledger_accounts (month) where kind = 'demo-budget';

create table public.credit_lots (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.ledger_accounts(id),
  credit_kind text not null check (credit_kind in ('granted','paid')),
  source      text not null,             -- 'grant:<grant id>', 'top-up:<stripe event>', 'transfer:<id>'
  remaining   numeric(14,4) not null check (remaining >= 0),
  expires_at  timestamptz,               -- granted lots only; paid lots never expire
  created_at  timestamptz not null default now(),
  unique (account_id, source)
);

create table public.holds (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null unique,       -- one hold per job; extending adds hold_lots
  account_id uuid not null references public.ledger_accounts(id),
  status     text not null check (status in ('open','released')),
  captured   numeric(14,4) not null default 0,
  margin     numeric(14,4) not null
);
create table public.hold_lots (hold_id uuid references public.holds(id), lot_id uuid references public.credit_lots(id), amount numeric(14,4) not null check (amount > 0), primary key (hold_id, lot_id));

create table public.ledger_entries ( … as draft 1, plus lot_id, hold_id; idempotency_key unique, prefixed by kind (§3.6) );
create table public.credit_grants ( … as draft 1, amount check (amount > 0), per_member boolean not null );
create table public.cohort_members (cohort_id uuid, user_id uuid, added_by uuid not null, added_at timestamptz, primary key (cohort_id, user_id));
```

- **Lot order:** a hold draws from granted lots with the earliest expiry
  first, then from paid lots, oldest first (L-6).
- **The balance** of an account is `sum(remaining)` over its unexpired lots,
  minus `debt`. Held amounts have already left their lots' `remaining`;
  that is the whole sign convention (L-2).

## 2. Grants, RLS, append-only

- **Grants and RLS (L-10):** `revoke all` from anon and authenticated on
  every ledger table. RLS allows members only to SELECT their own user
  account, its lots and entries; an owner may also read the course
  allowance. Every write goes through definer functions (§3), which are
  revoked from public, anon and authenticated and granted to
  `service_role` only.
- **Append-only (L-17):** `ledger_entries` has a `before update or delete`
  trigger that raises, for every role including the owner. `credit_lots`,
  `holds` and `hold_lots` change only inside the definer functions; each
  change writes a matching entry.
- **Actor (L-11):** every function takes `p_actor uuid`, set by the server
  from the verified session (a route never passes a user id from the
  request body; a scan test checks this). The function checks the actor
  itself:
  - `fund_allowance`: `course_role_of(package, actor) = 'owner'`;
  - `credit_grant` and `cohort_add`: `profiles.is_admin`;
  - the deputy-billing option: owner only.

## 3. Operations

### 3.1 Grants and cohorts (L-8)

- `credit_grant(actor, grant)`:
  - a user grant creates one lot on that user's account;
  - a cohort grant is either per member (`per_member`: each member's lot
    is created when they are added) or a pool on a cohort account.
- `cohort_add(actor, cohort, user)`: operator only. Creates the member's
  lot with source `grant:<grant>:<user>`, which is unique, so leaving and
  rejoining never yields a second lot. Adding after the grant's
  `expires_at` or `ended_at` creates nothing.
- Ending a grant (`ended_at`) expires its unused lots at once. Spent credit
  is never clawed back.

### 3.2 Top-ups (L-12)

The Stripe webhook:
1. verifies the signature and re-fetches the event from Stripe;
2. accepts only `checkout.session.completed` with `payment_status = paid`,
   or `checkout.session.async_payment_succeeded`;
3. takes the user id from the server-set `client_reference_id` (never from
   the payload body);
4. converts with the price row in force when the checkout was created
   (`credit_prices`, versioned);
5. creates a paid lot, source `top-up:<event id>`.

`charge.refunded` and `charge.dispute.created` reduce that lot's
`remaining` by the refunded credit. If the credit was already spent, the
rest goes to `debt`, and the account's new holds are refused until the debt
is cleared.

> **Amended 2026-10-27 (E5 adversarial review, migration 0044).**
> - Disputes use `charge.dispute.funds_withdrawn` and
>   `charge.dispute.funds_reinstated` instead of `.created`. Inquiries move
>   no money, and a won dispute gives the credit back (paying debt first).
> - Refunds and disputes are kept as the **state** of each payment: Stripe's
>   running refund total, plus disputes whose money is withdrawn. Credit is
>   reconciled to `paid − refunded − withdrawn` after every event, so event
>   order, retries, and a refund arriving before the payment is recorded
>   all end the same.
> - Credits are rounded to the ledger's 4 decimals, so there is no
>   rounding dust.
> - Paid events that can't be matched go to `stripe_problems` for the
>   operator.

### 3.3 Course allowance (L-7)

- `fund_allowance(actor, package, month, amount)`: owner only. It moves
  **paid** credit only, from the owner's lots to a new lot on the
  allowance account (`transfer:<id>`).
- Granted credit can't be moved, so its expiry can't be escaped.
- At month end the unused allowance returns to the owner's account as paid
  credit. On a transfer of ownership, it returns to the old owner.

### 3.4 Holds, captures, release (L-1–L-5, L-15, L-16)

All under the account row lock.

**`hold(actor, job, account, estimate)`:**
- Idempotent by `hold:<job>`.
- Draws `estimate` from lots in lot order into `hold_lots`; refuses if the
  balance is below the estimate (fail closed).
- `margin = min(max(10% of estimate, 1), the account's free margin)`. Each
  account may have at most **5 credits of margin outstanding** across all
  open holds, so parallel holds can't compound an overrun.
- **`extend(job, more)`** adds lots to an open hold; it is used when a job
  outgrows its estimate (A-5).

**`capture(job, call_id, cost)`:**
- Idempotent by `capture:<job>:<call_id>`. A repeat with a different cost
  raises an alert and is not applied (L-13).
- The cost is rounded **up** to 4 decimals.
- It adds to `holds.captured`. The part beyond the hold's drawn amount is
  first drawn from lots (in lot order), then from the margin; anything
  beyond that goes to the account's `debt`. Every overrun is recorded,
  never free (L-2).
- On a released hold, the cost is drawn from lots directly and the rest
  goes to debt (L-3).

**`release(job)`:**
- Idempotent by `release:<job>`; it is a no-op once the hold is
  `released` (L-4).
- Returns `drawn − captured` (never below 0) to the hold's lots, in reverse
  lot order. A lot that has expired meanwhile expires the returned amount
  at once (L-6).

**`refund(actor, job, call_ids[], reason)`:**
- Idempotent by `refund:<job>:<call_id>`.
- Refunds at most the captured cost of exactly those calls (L-5).
- Credit goes back to the lots it came from, and the expired-lot rule
  applies.
- "Platform fault" is decided by the platform: sandbox loss, gateway 5xx,
  a failed call. It is never set from a request.

**Orphan sweep (L-16):** every 5 minutes, holds of jobs that ended, or
that have shown no activity for 1 hour, are released.

**Late usage (L-3):** a nightly job reconciles the gateway's usage records
against the captures and applies any missing ones.

### 3.5 Gateway callbacks (L-14)

The gateway's usage callback is authenticated:
- an HMAC signature with a shared secret;
- a timestamp, with replay-window checks;
- the job's key id, which must match `jobs.gateway_key_id`.

Anything else is refused.

### 3.6 Idempotency keys (L-13)

Every key is prefixed by kind and scoped: `hold:<job>`,
`capture:<job>:<call>`, `release:<job>`, `refund:<job>:<call>`,
`top-up:<event>`, `grant:<grant>:<user>`, `transfer:<id>`.

## 4. Who pays

As draft 1 §3 (requester; course allowance for automatic work; the owner
for a deputy's "approve and draft materials" if the owner turned that on;
demo budget for try mode). Quick asks hold and capture on the asker's
account. The **existing `ai.ts` governor path is removed** for every AI call
that moves to the ledger: its rate-limit and budget checks fail open (L-18).

## 5. Units (A-4)

One credit has a price in USD (`credit_prices(version, usd_per_credit,
from)`, operator-set). The gateway reports cost in USD; `capture` converts
with the price in force at the hold.

## 6. Demo budget (A-6)

A `demo-budget` account per month, funded by the operator through
`credit_grant`. Try mode holds against it with the per-browser and
per-network limits of design §11.5.

## 7. Claims

| Claim | What |
|---|---|
| L.1 | entries are append-only for every role, including the table owner (trigger) |
| L.2 | property test over random operation sequences: balance = sum of unexpired lot remainders − debt, and equals grants + top-ups + transfers − captures − expiries − refunds-out + refunds-in |
| L.3 | concurrent holds and quick asks on one account never take more than the balance (**real Postgres**, many connections) |
| L.4 | hold, capture, release, refund are idempotent; a repeated capture key with a different cost alerts and is not applied |
| L.5 | an overrun beyond hold + margin goes to debt; debt blocks new holds |
| L.6 | a late capture after release is charged |
| L.7 | lot order: earliest-expiring granted first; release into an expired lot expires it; expiry never touches paid lots |
| L.8 | the allowance takes paid credit only, and returns unused at month end |
| L.9 | cohort add is operator-only, once per (grant, user), and creates nothing after the grant ended or expired |
| L.10 | members can't insert, update or delete any ledger table; they read only their own account |
| L.11 | functions check the actor themselves (owner, operator); no route passes a body-supplied user id (scan) |
| L.12 | Stripe: unsigned or unpaid events refused; refund or dispute reduces credit or creates debt |
| L.13 | gateway callbacks without a valid signature, or with another job's key, are refused |
| L.14 | the orphan sweep releases holds of dead jobs |
| L.15 | total outstanding margin per account ≤ 5 credits |
| L.16 | AI calls on the ledger fail closed (`ai.ts` fail-open path removed for them) |

## 8. Review resolutions (G7 round 1)

| Finding | Resolution |
|---|---|
| L-1 concurrency | §1 account-row lock in every function; L.3 on real Postgres |
| L-2 sign error | §1 lots hold the money; §3.4 overruns from lots, then margin, then debt |
| L-3 capture after release | §3.4 late usage charged; nightly reconciliation |
| L-4 idempotency of hold and release | §3.4, §3.6 |
| L-5 refunds | §3.4 per-call, capped, idempotent, platform-decided |
| L-6 expiry and held credit | §1 lots, lot order; §3.4 expired-lot rule |
| L-7 allowance laundering | §3.3 paid credit only; month-end return |
| L-8 cohorts | §3.1 |
| L-9 duplicate accounts | §1 partial unique indexes, kind check |
| L-10 grants and RLS | §2 |
| L-11 actor | §2 |
| L-12 Stripe | §3.2 |
| L-13 key namespace | §3.6 |
| L-14 callbacks | §3.5 |
| L-15 margin | §3.4 per-account cap |
| L-16 orphan holds | §3.4 sweep |
| L-17 append-only | §2 trigger |
| L-18 fail-open path | §4 |
| L-19 | §1 checks; rounding up |
| A-4, A-5, A-6 | §5, §3.4 extend, §6 |

## 9. Round 2 resolutions (G7 round 2) — these rules take precedence

1. **The margin is not money (H1).** Any capture beyond what the hold drew
   from lots goes **straight to debt**. The margin only says how far into
   debt a job may run before it is stopped; it is never a source of credit.
   (Replaces "then from the margin" in §3.4.)
2. **Jobs are capped (H2).** The job's gateway key has a spending cap of
   `drawn + margin`. When it is reached, the orchestrator calls `extend`;
   if `extend` fails, the job stops at a safe point and the session gets
   `paused:budget`. Claim L.17.
3. **Refunds never touch `captured` (H3).** A refund returns the refunded
   cost to the lots it came from; a part that went to debt reduces debt
   instead. `release` uses `drawn − captured` as before, so nothing is
   returned twice. L.2 covers refund-then-release sequences.
4. **Transfers keep their origin (H4).** `fund_allowance` records the
   source top-up lot of each credit it moves. A Stripe refund or dispute
   takes credit back first from the allowance lot it funded (unused part),
   then from the owner's lots, then to the owner's debt. While the owner has
   debt, `fund_allowance` and holds on that owner's allowances are refused.
5. **Hold takes the payer from the job (H5).** `hold(actor, job, estimate)`
   reads `jobs.payer_account_id` and checks it against the actor with the
   §4 rules (requester's own account; the course allowance only for
   automatic or checkpoint jobs of a course where the actor is a member; the
   owner's account for a deputy's draft only if the owner enabled it; the
   demo budget only for try-mode jobs). There is no account parameter.
   L.11 covers it.
6. **Debt is cleared first (L-12).** Every new lot (top-up, month-end
   return, grant) pays off debt before it becomes spendable.
7. **Month-end return** is idempotent (`return:<package>:<month>`).
   Releases or refunds landing on an allowance after its month ended go
   straight back to the owner.
8. **Cohort pools** are accounts of kind `cohort-pool`. Only the members
   of the cohort spend from it, and only for their own requests (the payer
   rule in item 5).
9. **`extend` failing** ends the step and pauses the job (`paused:budget`);
   the job resumes when credit is available and `extend` succeeds. The
   runtime spec's "the next step needs a new hold" means `extend` on the
   job's single hold (C1).
