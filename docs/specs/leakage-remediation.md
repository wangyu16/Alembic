# Leakage Remediation Runbook (M21)

**Status:** Phase 3 procedure. What to do when private content reaches the
**public** repository. Pairs with the M20 reconciliation quarantine and the M21
full-tree leak audit.

> The two-repo invariant (`assertPathAllowedInRepo`, fail-closed +
> `validateCommitPlan`) makes a leak **via Alembic** impossible — every commit
> Alembic makes is validated before the transport, with no override. A leak can
> therefore only enter through a path Alembic does not control: a **foreign
> commit** (an educator/collaborator editing the public repo directly in
> VS Code or on GitHub), a mis-created repo, or content that predates Alembic.
> This runbook is the last-resort cleanup for that case.

## 1. Detection (automated)

- **At reconcile time (M20):** `reconcilePublicRepo` validates every
  externally-changed path. A `private-instructor/…` path (or any disallowed
  layer) in the public repo → the change is **quarantined**, never absorbed, and
  the violating paths are surfaced. The synced pointer is *not* advanced, so the
  divergence stays visible.
- **Full-repo audit (M21):** `scanPublicRepoForLeaks` → `findLeakedPaths` lists
  **every** blob in the public tree and flags any that violate the invariant
  (not just a diff). Surfaced in the editor's **Review → "Check for outside
  changes" → "Scan for leaks"**. Logs `leak.detected`.
- A truncated tree (very large repo) makes the audit *inconclusive* — verify on
  GitHub directly rather than trusting a clean result.

These detect a leak in the **current tree**. Note: Git **history** can still
contain a private blob that was added and later deleted in a normal commit —
deleting a file does not remove it from history. Remediation below addresses
history, not just the working tree.

## 2. Remediation procedure (deliberate, guarded — NOT one-click)

Purging Git history is destructive and irreversible; it is intentionally a
manual/operator step, never automated from the editor. Steps, in order:

1. **Contain.** Stop publishing/building from the affected repo. If the leaked
   content includes any **secret** (answer key, token, credential), treat it as
   compromised the moment it was pushed — **rotate it now**. History rewrites do
   not un-ring that bell: anyone who cloned/forked, and GitHub's caches, may
   still have it.
2. **Confirm scope.** Run the audit and inspect the public repo's history for
   the offending path(s):
   `git log --all --full-history -- <path>`. Note every commit that introduced
   or carried it.
3. **Rewrite history to purge the path(s).** Either:
   - **Clean re-publication (preferred, simplest):** replace the branch with a
     single fresh **root commit** containing only the current, validated,
     leak-free tree. The bridge mechanism already exists —
     `GitHubClient.publishToBranch` builds a parentless commit and force-updates
     the ref (the same primitive the Pages branch uses). Caller MUST pass a tree
     that passes `validateCommitPlan` first. This discards all prior history
     (acceptable for an OER repo; snapshots/tags that referenced bad commits
     must be re-cut). Or
   - **Surgical purge:** `git filter-repo --path <path> --invert-paths` (or BFG)
     locally, then force-push. Use when history must be preserved.
4. **Forced re-publication.** Force-push the cleaned branch; re-run the
   site build so GitHub Pages serves only clean content. Re-cut any snapshots
   (tags) that pointed at purged commits.
5. **Incident provenance note.** Commit an `INCIDENT.md` (or append to the
   package's provenance) recording: what leaked, when it entered, when it was
   purged, and what was rotated — without re-exposing the content. Log
   `leak.remediated`.
6. **Verify.** Re-run "Scan for leaks" → clean. Confirm the path is absent from
   history (`git log --all --full-history -- <path>` returns nothing).

## 3. Prevention (already in place)

- Commit-time `validateCommitPlan` (fail-closed, no override) on every Alembic
  write — the primary guarantee.
- M20 reconcile quarantines foreign commits that would introduce a leak, so the
  bad state is never absorbed into the projection or re-pushed by Alembic.
- The public repo is generated from validated content; collaborators editing
  directly are the residual risk this runbook covers.

## 4. What is deferred (tracked)

- **One-click in-app remediation.** The destructive purge stays a guarded
  operator step; wiring a confirmed, audited in-app "purge & re-publish" action
  (reusing `publishToBranch` on the default branch behind a typed confirmation)
  is a future hardening item.
- **History-walking detection.** The audit scans the current tree; scanning the
  full commit history for a since-deleted leak is a heavier future check.
- **Private-repo reconciliation.** M20/M21 scope the public repo (the invariant
  surface). Private-repo external edits are future work.
