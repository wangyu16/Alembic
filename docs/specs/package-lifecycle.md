# Package Lifecycle — rename & delete

Options and rationale for renaming and deleting packages. **Implemented**
(workspace rename / delete / archive / restore; migration `0012_lifecycle.sql`).
This note records the design and the one deliberate change from the original
draft: Alembic never deletes repositories itself — the educator deletes them on
GitHub and Alembic reconciles (see Delete §, below).

Related: [package-contract-v1.md](package-contract-v1.md) · [goal.md](../goal.md)

---

## Principles this must respect

- **`packageId` is immutable** and decoupled from repo/display names (it
  "survives repo renames/transfers").
- **Repos are the source of truth and educator-owned.** The platform's DB is a
  rebuildable projection; removing platform state must not, by itself, destroy
  the educator's materials.
- **Git history is permanent**, and published OER may be **cited, adapted, or
  linked** by others. Destroying a published package is high-stakes.
- **No lock-in:** a package must remain usable without Alembic.

## Rename

Two distinct concepts — keep them separate:

| Kind | Allowed? | What happens |
| --- | --- | --- |
| **Title** (display name) | Yes — cheap, safe, anytime | Update `title` in the manifest/metadata. Sandbox: update the `packages` row + `alembic.json`. GitHub-backed: same, plus commit the updated `alembic.json`; the next site build picks up the new heading. Repo names and `packageId` are unchanged. |
| **Identity / repo names** | Out of scope | `packageId` never changes. Renaming the GitHub repos is GitHub's own operation (with redirects) and only needs to be *tolerated* on sync — not a platform feature. |

Rationale: title is pure metadata with no traceability impact; identity rename
would break the stable-ID guarantee that adaptation/citation/provenance rely on.

## Delete

Sandbox and GitHub-published packages differ sharply.

### Trial sandbox — simple, low-stakes
Delete = remove the `packages` row. FK cascades clean up `sandbox_files` and
any `portal_registrations`; `ai_invocations.package_id` is set null;
`research_events` rows remain (append-only log, no FK). Never shared, so a
single confirmation is enough. **Allowed.**

### Published via GitHub — archive, not delete (implemented)
"Delete" on a published package **archives** it; Alembic never destroys an
educator's repos.

1. **Archive** (the "delete" action for published packages) — set
   `packages.archived_at` and delete the `portal_registrations` row. The package
   drops out of the workspace list and the public index, but **both repos and
   the live site are untouched** and it can be **restored** anytime (clear
   `archived_at`). Honors no-lock-in: the OER keeps working without Alembic.
2. **True deletion is the educator's GitHub operation.** To remove a package for
   good, the educator deletes the repositories on GitHub directly. Alembic does
   **not** need (and is not granted) repo-delete rights. Instead,
   **reconciliation** (`reconcileArchivedPackages`) checks each archived
   package's **public** repo via `GitHubClient.repoExists`; when it returns 404,
   the archived row is **purged** (`package.purged`). Non-404 errors never
   trigger a purge, so a transient failure is never mistaken for a deletion.

This replaces the original draft's "delete both repos via the GitHub App
(Administration rights)": pushing the destructive action to GitHub is safer
(no delete scope on the App), matches "repos are the source of truth," and gives
the educator an undo (archive → restore) for everything short of deleting on
GitHub. Purge keys on the **public** repo (the canonical, citable one).

## Phasing — status

1. ✅ Title rename (sandbox + GitHub) — `renamePackageAction`.
2. ✅ Delete sandbox package — hard delete, one confirm, no recovery.
3. ✅ Archive / restore for GitHub packages — repos stay with the educator.
4. ✅ True deletion via GitHub + reconciliation purge — no App delete scope.
