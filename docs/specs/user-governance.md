# User governance — admin, account status, AI approval

**Status:** design approved (2026-07-10). UG0–UG5 shipped; UG6 (this doc + Status.md) done. Migrations `0016`–`0018` applied to production 2026-07-10.

Alembic stays **open to everyone**: anyone can sign up with a GitHub account and
start authoring. This spec adds three things on top of that:

1. a **platform admin** (`wangyu16`) who can see the registered users;
2. the ability to **disable** an account that violates the rules;
3. **AI access off by default**, granted only by explicit admin approval.

**Disabling is a login block** (owner decision, 2026-07-10, revising an earlier
read-only design). A published package lives in the educator's own GitHub
repositories, which Alembic does not control and cannot take away — so an
elaborate read-only mode inside Alembic protects nobody and costs a gate on
every write path. Blocking the account at the auth layer is both simpler and
stronger.

The caveat, recorded because it is easy to forget: **trial packages live only in
Supabase** (see Status.md, trial-storage policy). A banned educator therefore
loses any *unpublished* course, permanently, with no way to sign in and export
it. The Disable dialog states the count of unpublished packages before the
admin confirms; the loss is a deliberate choice, not a surprise.

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

The column this spec adds (`ai_status`) lives in the same table under the same
policy. Without the fix, a user approves their own AI access — and, via
`is_admin`, grants themselves the page that approves everyone else's. **The fix
is a prerequisite, not a companion.**

**Fix.** RLS cannot express column restrictions; the correct tool is a
column-level `GRANT`. Revoke blanket UPDATE from `authenticated` and re-grant
exactly the columns a user may set on themselves:

```sql
revoke update on public.profiles from authenticated;
grant  update (display_name) on public.profiles to authenticated;
```

`is_admin`, `ai_status`, `github_installation_id` and the audit columns then
become writable only by the service role (server-side, behind `requireAdmin()`),
regardless of what RLS allows. The row policy stays as the second lock.

Adversarial test required: a non-admin user client attempting to set `is_admin`,
`ai_status`, or `github_installation_id` on their own row must be rejected.
`supabase/tests/0016_verify_profile_grants.sql` does exactly that.

---

## 1. Model

Two axes, deliberately stored in **different places**, because they are enforced
by different authorities.

| Axis | Source of truth | Values | Default |
|---|---|---|---|
| May this account sign in? | `auth.users.banned_until` (Supabase native) | timestamp \| null | null (allowed) |
| May it invoke the AI assistant? | `public.profiles.ai_status` | `none` \| `requested` \| `approved` | `none` |

`is_admin boolean` (migration `0011`) already exists and is reused unchanged.

**There is no `profiles.status` column.** Account suspension is Supabase's own
`banned_until`, set through `auth.admin.updateUserById(id, { ban_duration })`.
Mirroring it into `profiles` would create two sources of truth that drift the
first time one write succeeds and the other fails. Everything that needs to know
reads `auth.users` — the admin list via `auth.admin.listUsers()`, the database
via the `is_active_user()` helper below.

Fail-closed by construction: `ai_status` defaults to `none`, so an account
nobody has thought about has no AI. Existing accounts are **not** grandfathered
— the bootstrap grants admin + AI to `wangyu16` alone.

`admin_audit` records who did what to whom, when, and why. It is service-role
only (not readable by `authenticated`).

### AI access flow

`none` → *(educator clicks "Request access")* → `requested` → *(admin decides)*
→ `approved` or back to `none`. An admin may revoke at any time
(`approved` → `none`). A disabled account cannot request.

The request transition is the only privileged write an ordinary user may
trigger. It is performed by a server action using the service client, which sets
`ai_status = 'requested'` **only** when the current value is `none`. (No active
check is needed: a banned account cannot hold a session to call the action, and
the residual-token window is closed by `is_active_user()`.) A user can never
write `approved`.

---

## 2. Enforcement

### 2.1 Disabling → Supabase's own ban, plus one RLS backstop

`auth.admin.updateUserById(id, { ban_duration: "876000h" })` sets
`auth.users.banned_until`. GoTrue then rejects new sign-ins **and** refresh-token
exchange for that account. Re-enabling is `ban_duration: "none"`.

**A ban does not kill a live session.** `auth.admin.signOut()` requires the
target user's own JWT, which an admin does not have, and a JWT is stateless — it
cannot be revoked. So an access token minted before the ban stays valid until it
expires (Supabase default: 1 hour). A user banned mid-session keeps writing for
up to that long.

That window is closed in the database, where it costs nothing per call site:

```sql
create function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = (select auth.uid())
      and (banned_until is null or banned_until < now())
  );
$$;
```

Add `and public.is_active_user()` to the `with check` (and `using`, for
UPDATE/DELETE) of every **write** policy: `packages`, `sandbox_files`,
`portal_registrations`, `documents`, `suggestions`, `package_changes`,
`ai_invocations`, `research_events`. Reading `auth.users` keeps `banned_until`
the single source of truth — no mirrored column, nothing to drift.

This is a backstop, not the mechanism. It needs **no application changes**, no
`requireActiveUser()`, and no gate on the GitHub commit paths: a banned user
cannot obtain a session, and within the residual token window every Supabase
write fails and — because every mutating GitHub action is a server action posted
to a `/workspace/*` route — middleware also refuses them.

**SELECT policies are untouched**, so nothing about *reading* changes. That is
incidental now, not a feature: a banned user has no session with which to read.

### 2.2 GitHub commits

No dedicated gate. They require a signed-in session, which a banned user cannot
obtain or refresh. Within the ≤1h residual window they are stopped by middleware
(server actions post to the matched `/workspace/*` path).

Recorded for whoever revisits this: `clientForUser` (`lib/github.ts:102`) is
**not** the only door to an installation token — `github-actions.ts:166` calls
`clientForInstallation` directly, and that is the main publish path. Any future
per-user GitHub gate must cover both.

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

### 2.4 Middleware

`apps/web/src/middleware.ts` already redirects unauthenticated traffic away from
`/workspace/*`. It gains a ban check that signs the session out and redirects to
`/suspended` with the reason. This closes the residual-token window for all app
traffic (including server actions, which post to the matched route) and gives the
educator an explanation rather than a dead end.

It is a UX and defence-in-depth layer. The security boundary is GoTrue's refusal
to refresh (§2.1) plus the RLS backstop.

Note: **no `requireActiveUser()` consolidation is needed** under the ban model —
that was required only by the abandoned read-only design, which had to gate 25
call sites. The 17 duplicated `requireUser()` helpers remain a latent
maintainability wart, tracked separately, not a security dependency here.

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
  signed-in state (`banned_until`), AI status;
- filter to `ai_status = 'requested'` — the pending queue;
- actions: **Approve AI** / **Revoke AI**, **Disable** (requires a reason) /
  **Re-enable**.

Account rows come from `auth.admin.listUsers()` (for `banned_until`) joined to
`profiles` (for `github_username`, `ai_status`).

Guardrails, enforced server-side:

- an admin cannot disable **themselves** (that is how you lock yourself out of
  the only page that can undo it);
- an admin cannot disable another admin;
- **Disable** shows the target's count of *unpublished* packages before
  confirming — those live only in Supabase and are lost with the account (§0
  preamble). The admin confirms with that number in view.
- every action appends to `admin_audit(actor_id, target_id, action, reason)`.

## 4. Educator-facing UX

- **Disabled:** they cannot sign in. `/suspended` explains the account is
  suspended, shows the reason, and gives a contact route. Middleware sends any
  live session there.
- **AI not approved:** the Assistant button renders disabled with a **Request
  access** action; once requested it reads "Access requested". The hosted
  `orz-host-ai` bridge is not wired, so the in-file editors advertise no AI
  operations. Server-side enforcement stands regardless of what the UI shows.

## 4a. Deploy order (the two orderings are opposite — read this)

`0016` and `0017` constrain deployment in **opposite directions**. Getting
either backwards breaks production.

| Step | Why this order |
|---|---|
| 1. Deploy UG0 code (`24c1da6`) | The install callback must already use the service client. Once `0016` lands, its old user-client write is denied. New code works before *and* after; old code breaks after. |
| 2. Apply `0016` + run its verify script | Closes the escalation hole. |
| 3. Apply `0017` + `0018` | Creates `can_use_ai()`. Old deployed code never calls it, so nothing changes yet. AI keeps working for everyone. |
| 4. Deploy the UG1–UG3 code | The AI gate calls `can_use_ai()`. **If deployed before `0017`, the RPC errors — and the gate fails closed, so AI stops for everyone, including the owner.** |

So: **code before migration for G0; migration before code for G3.**

## 5. Bootstrap

`wangyu16` is seeded by migration: `is_admin = true`, `ai_status = 'approved'`
(never banned). The `handle_new_user()` trigger also consults a
`admin_bootstrap_logins` table so a fresh database (or a re-signup) still
produces an admin without manual SQL.

`profiles.github_username` is overwritten by the GitHub App install callback
(`api/github/installed/route.ts:33`) with the *installation account* login,
which may be an org. `is_admin` is a separate column and is unaffected once
set — but do not key any future admin check off `github_username`.

## 6. Subtasks

Ordered; each independently verifiable and separately revertible. Durable logic
first, thin client last (CLAUDE.md rule 9).

- **UG0 — column-grant fix (done first, alone; shipped `24c1da6`).** Migration
  `0016` + `supabase/tests/0016_verify_profile_grants.sql`. A security fix,
  independent of everything below.
- **UG1 — schema.** `profiles.ai_status` + AI audit columns, `admin_audit`,
  `admin_bootstrap_logins`, `is_active_user()`, bootstrap seed for `wangyu16`.
- **UG2 — RLS write policies.** Add `is_active_user()` to every write policy.
  Adversarial verification: a banned user's insert/update/delete is rejected;
  select still works (no session in practice, but the policy must be right).
- **UG3 — AI gate.** `GovernedProvider.generateText` fails closed unless
  `ai_status = 'approved'` and the user is not banned. Tests incl. DB-error →
  deny. Must **not** copy the fail-open rate-limit/budget neighbours.
- **UG4 — admin users page + actions + audit + unpublished-count warning.** ✅
- **UG5 — educator UX** (`/suspended`, middleware ban check, Request access). ✅
  The middleware ban check fails **open** on RPC error, deliberately: it is a UX
  and defence-in-depth layer, and the RLS backstop still refuses the writes.
  (This also made the deploy safe in either order — before `0017` existed, the
  RPC simply errored and middleware let traffic through.) Selection-AI's overlay
  is gated alongside the Assistant button; leaving it visible would have given an
  unapproved educator a control whose only outcome is a server-side refusal.
- **UG6 — docs + Status.md.**

Dropped from the original plan when disabling became a login block: the
`requireActiveUser()` consolidation across 25 call sites, and the GitHub-commit
gate. Both existed only to serve the read-only design.
