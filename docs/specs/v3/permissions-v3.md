# Permissions v3 (membership, `can()`, RLS) — mini-spec

**Status:** draft for gate G0, 2026-10-27. Module A2. Design source:
`ALEMBIC-WORKSPACE-DESIGN.md` §2 (the permission matrix is the only
authority), §10, §13 (RLS row), R23, R31.

## 1. Today

- Course data is scoped by RLS `owner_id = auth.uid()` on `packages` and
  per-table policies derived from it (48 policies, 0001–0035); the app
  queries mostly without explicit owner filters and relies on RLS.
- Public reads (Discover, portal, permalinks of published public files) use
  the service-role client behind explicit checks (`permalink-access.ts`,
  `share-policy.ts`), plus public-read policies on the discovery tables.
- Admins: `profiles.is_admin`, `requireAdmin`.

## 2. Model

```sql
create table public.course_members (
  package_id uuid not null references public.packages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner','co-author')),
  deputy_until timestamptz,          -- non-null and in the future = deputy
  added_by   uuid references public.profiles(id),
  added_at   timestamptz not null default now(),
  primary key (package_id, user_id)
);
-- exactly one owner per course
create unique index course_members_one_owner on public.course_members(package_id) where role = 'owner';
```

- `packages.owner_id` stays as a denormalised copy of the owner row, kept
  equal by a trigger (one place to read the owner for GitHub calls).
- A deputy is a co-author with `deputy_until > now()`. No separate role
  value: expiry needs no job.
- Invitations: `course_invitations(id, package_id, email_or_login, role,
  token_hash, expires_at, accepted_by, accepted_at)`; accepting inserts the
  member row through a security-definer function that checks the token.

## 3. Roles and actions

`Role = 'owner' | 'deputy' | 'co-author' | 'agent' | 'operator' | 'none'`.

`Action` is a closed union, one value per §2.2 matrix row (31 rows), e.g.
`edit.materials`, `edit.plan`, `edit.private`, `approve.plan`,
`publish.first`, `publish.later`, `publish.anyway`, `list`, `share`,
`license.change`, `members.invite`, `members.remove`, `deputy.name`,
`member.leave`, `source.upload`, `source.see-file`, `source.use-ai`,
`source.see-pointer`, `agent.answer`, `correction.keep-undo`,
`finding.fix`, `obligation.confirm`, `both-changed.decide`,
`edited-elsewhere.accept-undo`, `suggestion.decide`, `update.take`,
`history.restore-doc`, `snapshot.create`, `snapshot.restore-course`,
`steering.change`, `steering.propose`, `coursewerk.update`,
`handout`, `transfer`, `archive`, `agent.talk`, `history.see`,
`github.direct`, `allowance.fund`.

```ts
can(role: Role, action: Action, ctx?: {
  path?: string;            // for edit.* and source.* checks
  uploaderId?: string;      // for source.see-file
  actorId?: string;         // the caller
  sharedWithCourse?: boolean;
  addressedTo?: string[];   // for both-changed.decide
  isFirstPublish?: boolean; // publish.first vs publish.later
}): boolean
```

- Pure, in `packages/package-contract/src/access.ts`; the matrix is a
  literal table in code mirroring design §2.2, with a test that every
  action has an entry for every role.
- `roleOf(member | null, isAdmin)` derives the role: member row → owner /
  deputy / co-author; agent requests carry `agent`; admin pages carry
  `operator` only for operator actions; otherwise `none`.

## 4. Enforcement

Two layers, both required:

1. **Server**: every server action and API route resolves the caller's role
   for the course and calls `can()` before any read or write. A helper
   `requireCan(packageId, action, ctx)` throws a typed `Forbidden`.
2. **Database (RLS)**: defence in depth. Policies change from
   `auth.uid() = owner_id` to membership:

```sql
create function public.is_member(p uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from public.course_members m
                       where m.package_id = p and m.user_id = (select auth.uid())) $$;
create function public.is_owner(p uuid) returns boolean … role = 'owner' …;
```

- Read of course rows: `is_member(package_id)`.
- Writes of course content rows: `is_member(package_id)`; owner-only
  columns (license, listing, sharing, archive) are changed only through
  security-definer functions that check the role (column-level intent can't
  be expressed by row policies alone).
- `course_members` itself: members read their course's rows; inserts and
  deletes only through security-definer functions (`invite`, `accept`,
  `remove_member`, `leave`, `name_deputy`), each checking the role.
- Public-read policies (discovery tables) and the service-role paths stay
  as they are.
- Source pointers: the file link is issued by the server only after
  `can(role, 'source.see-file', {uploaderId, sharedWithCourse})`.

## 5. Claims (bound to tests)

- **A2.1** For every (role, action) pair, `can()` equals the design §2.2
  matrix (table-driven test generated from one literal).
- **A2.2** A non-member can read or write no row of another course, through
  any table with a `package_id` (PGlite, every table enumerated from the
  schema so a new table can't be forgotten).
- **A2.3** A co-author can read and write content rows but cannot change
  license, listing, sharing, members, deputy, archive (each attempted through
  the API and directly through PostgREST with the user's JWT).
- **A2.4** A deputy's rights end at `deputy_until` without any job running.
- **A2.5** Exactly one owner per course at all times; transferring ownership
  is one transaction.
- **A2.6** Every server action and API route under `app/` that touches a
  course calls `requireCan` (scan test, like the existing
  `manifest-writers.scan.test.ts`).
- **A2.7** Public-read behaviour of Discover, portal and permalinks is
  unchanged (existing tests stay green).
- **A2.8** A removed member loses access in the same transaction (no cached
  role survives: roles are resolved per request).

## 6. Migration

R31: no backward compatibility is needed for courses, but the two current
users' accounts carry over. The cut-over migration inserts an owner row for
each remaining package from `owner_id`. Built and tested on PGlite and the
testing project first.
