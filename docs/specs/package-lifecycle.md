# Package Lifecycle — rename & delete (design note)

Options and rationale for renaming and deleting packages. **Not implemented in
v0.1** (today the only related actions are portal "Remove from index" and
per-section delete in the editor). This note records the intended design so it
slots in cleanly later.

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

### Published via GitHub — split into two clearly-labeled actions
Never conflate these:

1. **Remove from Alembic** (default, safe) — delete only the platform
   projection/listing; **leave both repos with the educator**. Honors
   no-lock-in and the account-lifecycle promise: the OER and its live site keep
   working without Alembic. This is today's portal-unregister, generalized to
   "stop managing this here."
2. **Delete the repositories** (destructive, optional, heavily guarded) —
   actually remove the public **and** private repos via the GitHub App
   (Administration rights). Must: require typing the package name to confirm;
   warn that the public site goes down and that any citations/adaptations/links
   will 404; and state that Git history makes it unrecoverable. Bias toward
   **archive/unpublish** over hard deletion, since others may depend on a
   published OER.

Either path must operate on **both** repos of the pair and remove the portal
registration so the index never points at a dead site.

## Recommended phasing (when built)

1. Title rename (sandbox + GitHub) — easy, high value, low risk.
2. Delete sandbox package — safe, one confirm.
3. "Remove from Alembic" for GitHub packages — repos stay with the educator.
4. *(Later / guarded)* Delete repositories — the destructive path, with a
   typed confirmation and citation/adaptation warnings.

Steps 1–3 are low-risk and could ship in a v0.x; step 4 is deliberately
deferred and may stay an explicitly-confirmed advanced action.
