# User governance — admin, account status, AI approval

**Status:** design approved (2026-07-10), implementation in progress.

Alembic stays **open to everyone**: anyone can sign up with a GitHub account and
start authoring. This spec adds three things on top of that:

1. a **platform admin** (`wangyu16`) who can see the registered users;
2. the ability to **disable** an account that violates the rules;
3. **AI access off by default**, granted only by explicit admin approval.

Nothing here gates *reading* or *exporting*. A disabled educator keeps their
work and can take it with them — they already own the GitHub repositories, so
withholding an export would punish them without protecting anyone.

---

## 0. Prerequisite: a privilege-escalation hole in `profiles`

`supabase/migrations/0001_init.sql:21`:

```sql
create policy "update own profile" on public.profiles
  for update using ((select auth.uid()) = id);
```

RLS policies constrain **rows, not columns**. Postgres defaults an UPDATE
policy's `with check` to its `using` expression, so the new row must still
satisfy `auth.uid() = id` — a user cannot change their `id`, but they *can*
change any other column of their own row.

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is deliberately shipped to the browser
(`apps/web/src/app/signin/page.tsx:17`). So any signed-in user can bypass the
Next.js app entirely, call PostgREST with their own JWT, and set
`is_admin = true` on themselves. `profiles.is_admin` has existed since migration
`0011`, and `requireAdmin()` (`apps/web/src/lib/admin.ts:14`) trusts it. No
application code writes the column, which is why this has gone unnoticed.

Every column this spec adds (`status`, `ai_status`) lives in the same table
under the same policy. Without the fix, a disabled user re-enables themselves
and approves their own AI. **The fix is a prerequisite, not a companion.**

**Fix.** RLS cannot express column restrictions; the correct tool is a
column-level `GRANT`. Revoke blanket UPDATE from `authenticated` and re-grant
exactly the columns a user may set on themselves:

```sql
revoke update on public.profiles from authenticated;
grant  update (display_name) on public.profiles to authenticated;
```

`is_admin`, `status`, `ai_status` and the audit columns then become writable
only by the service role (server-side, behind `requireAdmin()`), regardless of
what RLS allows. The row policy stays as the second lock.

Adversarial test required: a non-admin user client attempting to set
`is_admin`, `status`, or `ai_status` on their own row must be rejected.

---

## 1. Model

Two independent axes on `public.profiles`. They are separate because they
answer different questions and are set by different events.

| Column | Values | Default | Meaning |
|---|---|---|---|
| `status` | `active` \| `disabled` | `active` | May this account change anything? |
| `ai_status` | `none` \| `requested` \| `approved` | `none` | May this account invoke the AI assistant? |

`is_admin boolean` (migration `0011`) already exists and is reused unchanged.

Fail-closed by construction: `ai_status` defaults to `none`, so an account that
nobody has thought about has no AI. Existing accounts are **not** grandfathered
— the bootstrap migration grants admin + AI to `wangyu16` alone.

Audit columns (`disabled_at/by/reason`, `ai_requested_at`, `ai_decided_at/by`)
record *who did what, when, and why*. Admin actions additionally append to
`admin_audit`, which is service-role-only (not readable by `authenticated`).

### AI access flow

`none` → *(educator clicks "Request access")* → `requested` → *(admin decides)*
→ `approved` or back to `none`. An admin may revoke at any time
(`approved` → `none`). A disabled account cannot request.

The request transition is the only privileged write an ordinary user may
trigger, and it is performed by a server action using the service client, which
sets `ai_status = 'requested'` **only** when the current value is `none` and
`status = 'active'`. A user can never write `approved`.

---

## 2. Enforcement — three layers, each fail-closed

No single layer covers everything, because three different authorities are in
play: Supabase RLS (row ownership), the GitHub App token (repository writes),
and the AI provider key (model calls).

### 2.1 Supabase writes → RLS

A `security definer` helper, so policies stay readable and one definition
governs all of them:

```sql
create function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'active'
  );
$$;
```

Add `and public.is_active_user()` to the `with check` (and `using`, for
UPDATE/DELETE) of every **write** policy: `packages`, `sandbox_files`,
`portal_registrations`, `documents`, `suggestions`, `package_changes`,
`ai_invocations`, `research_events`.

**SELECT policies are left untouched.** That is what makes a disabled account
read-only rather than locked out, and it is deliberate.

### 2.2 GitHub commits → application layer

RLS cannot see these: `commitFiles` is authorized by the GitHub App
installation token, not by a Supabase JWT. Gating `clientForUser`
(`lib/github.ts:102`) is **not sufficient** — `github-actions.ts:166` calls
`clientForInstallation` directly, and that is the main publish path.

So the gate belongs in a shared server helper that every mutating action calls
first (§2.4), with `clientForUser` hardened as defence in depth.

### 2.3 AI calls → `governedProvider`

Every one of the nine AI server actions funnels through `governedProvider`
(`apps/web/src/lib/ai.ts:204`), which already calls
`can({kind:"user"}, "ai")` at `:212` and throws `AINotEntitledError`. Today
`resolveEntitlements` (`lib/entitlements.ts:35`) hands **every** signed-in user
the `ai` capability. This is the chokepoint; the per-user check goes here.

Two constraints:

- `resolveEntitlements` is pure and synchronous; the approval flag needs IO.
  Do the DB read at the top of `GovernedProvider.generateText` (already async)
  and throw **before** `inner.generateText` (`ai.ts:180`).
- The neighbouring rate-limit and budget checks (`ai.ts:154`, `:166`)
  deliberately **fail open**. The approval gate must **fail closed** — on a DB
  error, deny. Do not copy the neighbours.

Do **not** put the gate in `packages/ai-operations`: it is a metadata catalog,
and only two of the nine actions consult it.

### 2.4 One shared `requireActiveUser()`

There is no shared `requireUser()` today — the three-line
`getUser()` + `redirect("/signin")` pattern is copied into 17 local helpers and
inlined in 8 more call sites. A gate added to "the helper" therefore protects
only the file it was added to, and **every future action fails open by
forgetting**. This is the core structural risk of the whole feature.

Consolidate to `apps/web/src/lib/auth.ts`:

- `requireUser()` → signed in, else redirect. (Reads, exports.)
- `requireActiveUser()` → signed in **and** `status = 'active'`, else redirect
  to a suspension notice. Every mutating action and every GitHub commit path
  calls this.
- `requireAdmin()` → existing, moved/kept, plus an `admin_audit` write helper.

### 2.5 Known ungated write

`apps/web/src/app/portal/actions.ts:21` (`reportPackageAction`) has no user
guard at all — `reporter_id` is nullable by design ("open to anyone"). A
disabled user can still file an abuse report. Left as-is intentionally; noted
so it is not mistaken for an oversight.

---

## 3. Admin surface

`/admin/users` (server-rendered, behind `requireAdmin()`, reads via the service
client because RLS restricts a user to their own profile row):

- table of accounts: GitHub login, display name, joined, package count,
  status, AI status;
- filter to `ai_status = 'requested'` — the pending queue;
- actions: **Approve AI** / **Revoke AI**, **Disable** (requires a reason) /
  **Re-enable**.

Guardrails, enforced server-side:

- an admin cannot disable themselves (locking yourself out of the admin page);
- an admin cannot disable another admin;
- every action appends to `admin_audit(actor_id, target_id, action, reason)`.

## 4. Educator-facing UX

- **Disabled:** a banner on `/workspace` explaining the account is suspended,
  with the reason and a contact route. Editors render read-only; Save, Publish
  and the Assistant are disabled with an explanatory title. Export still works.
- **AI not approved:** the Assistant button renders disabled with a **Request
  access** action; once requested it reads "Access requested". The hosted
  `orz-host-ai` bridge is not wired, so the in-file editors advertise no AI
  operations. Server-side enforcement stands regardless of what the UI shows.

## 5. Bootstrap

`wangyu16` is seeded by migration: `is_admin = true`, `status = 'active'`,
`ai_status = 'approved'`. The `handle_new_user()` trigger also consults a
`admin_bootstrap_logins` table so a fresh database (or a re-signup) still
produces an admin without manual SQL.

`profiles.github_username` is overwritten by the GitHub App install callback
(`api/github/installed/route.ts:33`) with the *installation account* login,
which may be an org. `is_admin` is a separate column and is unaffected once
set — but do not key any future admin check off `github_username`.

## 6. Subtasks

Ordered; each independently verifiable and separately revertible. Durable logic
first, thin client last (CLAUDE.md rule 9).

- **G0 — column-grant fix (do first, alone).** Migration + adversarial tests
  that a user client cannot set `is_admin` / `status` / `ai_status`. Ships
  independently of everything else; it is a security fix.
- **G1 — schema.** `status`, `ai_status`, audit columns, `admin_audit`,
  `admin_bootstrap_logins`, `is_active_user()`, bootstrap seed.
- **G2 — RLS write policies.** Add `is_active_user()` to every write policy.
  Adversarial tests: a disabled user cannot insert/update/delete; can still
  select.
- **G3 — `lib/auth.ts`.** `requireUser` / `requireActiveUser`; migrate the 17
  local copies + 8 inline checks. Mechanical, large, verifiable by grep.
- **G4 — AI gate.** `GovernedProvider.generateText` fails closed unless
  `status='active' and ai_status='approved'`. Tests incl. DB-error → deny.
- **G5 — GitHub gate.** Commit paths call `requireActiveUser()`;
  `clientForUser` hardened.
- **G6 — admin users page + actions + audit.**
- **G7 — educator UX** (banner, Request access, disabled controls).
- **G8 — docs + Status.md.**
