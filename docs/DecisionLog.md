# Decision Log

Dated record of concrete decisions — what was chosen, what is permanent by
design, and what is deferred to the future. Complements [Status.md](Status.md)
("what is done") with the "why" and the forward plan. Newest entry first.

---

## 2026-07-11 — Offline authoring, document round-trip, pre-upload hardening

Context: making Alembic ready for educators to **author a whole package offline
(with AI agents) and bring it in** — as a `.zip` upload today, or pushed to
GitHub later — plus the **download → edit offline → replace** round-trip for
individual documents.

### Decisions made (with rationale)

| # | Decision | Why |
|---|---|---|
| 1 | **`repoForPath(path)` is the single source of truth for the two-repo split.** A pure, total, fail-closed, dual-mode derivation in `package-contract`. | The split was total but only ever *checked* against a declared repo, never *derived*. A single tree (zip) must be split; one shared function stops the importer and the authoring skill from drifting. |
| 2 | **`validatePackageForImport` (`package-ops`) is the one import gate.** Wraps the pure `validateProject` with the platform's carrier extensions injected. | "If it passes, Alembic ingests with zero friction." The pure validator can't import a carrier registry; one wrapper wires it so the skill and the importer share exactly one check. |
| 3 | **A valid package must contain `alembic.json` + `LICENSE`.** `validateProject` now enforces both; the importer generates a LICENSE from the manifest if absent. | The minimal package shape was implicit (procedural in `createSandboxPackage`). Now it's enforced data. |
| 4 | **Study guide is stored as plain `study-guide/<slug>.md`** — the source of record. | Resolves the `.md` vs `.md.html` ambiguity. `.md.html`-as-committed-source is the **E3 target**, not current. The authoring skill and validator both say `.md`. |
| 5 | **Durable document identity = an embedded `uid` in the carrier's `#orz-meta` island** (`DocMeta.uid`, orz-markdown 1.6.0). The `uid` *is* the docId; `registerFile` matches it first. | The island survives in-file edits (`serializeDoc` never rewrites it), so identity travels *with the file* → permalinks survive rename/move/re-upload, and future whole-package / direct-GitHub origins inherit it with no rework. |
| 6 | **Package import creates a TRIAL package**, mints a **fresh platform `packageId`** (the author's is ignored), and registers with `origin: "uploaded"`. | The platform owns package ids (cross-user uniqueness). Import → trial → review → publish matches the existing lifecycle; publish still requires explicit approval (rule 8). |
| 7 | **Duplicate embedded `uid` across carriers is rejected on import.** | Two files claiming one identity would collapse to one docId (last-write-wins). Plausible when an agent clones a template island — caught at the door. |
| 8 | **Content-serving XSS: interim fix is a CSP `sandbox` opaque origin** on `/d/{docId}` + `/api/asset` (`allow-scripts`, no `allow-same-origin`, `nosniff`). | Self-contained docs legitimately carry scripts; sandboxing to an opaque origin lets them render but blocks access to the viewer's session. Closes the account-compromise vector without breaking the reader. |
| 9 | **U3 relative→permalink rewrite applies to plain markdown on the write path.** | Matches what "Insert" bakes in; makes cross-refs survive moves + downloads. Carrier-embedded refs are out of scope for now (need regeneration). |
| 10 | **Download in `DocumentActionsBar` gives the `.md` source**, not the dual-extension `.md.html`. | The `.md` is the source of record (matches the authoring skill). **Known inconvenience** (see Deferred #2): the downloaded `.md` isn't the directly-editable dual-extension file the in-app editor shows. |

### By-design constraints — permanent, NOT gaps

- **Trial packages are text-only.** A trial lives in Postgres; images/PDFs/media
  require a **published** (GitHub-backed) package. Import stores text now and
  **reports binaries** to add after publishing. This is the storage policy
  (`uploadVerdict` / `isBinaryPath`), confirmed permanent by the owner — do not
  "fix" it by letting a trial carry binaries.
- **Publish/registration always requires explicit educator approval** (rule 8).
  Import never auto-publishes.
- **The two-repo invariant is never bypassed.** `private/` (v2) /
  `private-instructor/` (v1) content never reaches the public repo; enforced
  fail-closed at every write, doubly so on import (derive by path, then
  `assertPathAllowedInEitherContract` before persist).

### Deferred to the future (planned, not built)

1. **Direct-to-GitHub ingest.** Author offline → push straight to GitHub → Alembic
   ingests. Needs **private-repo reconcile** (today's `reconcilePublicRepo` is
   public-only by explicit design) and **bootstrap-a-package-from-two-existing-repos**
   (reconcile currently assumes Alembic already created the package). Public-repo
   reconcile already works.
2. **Download the directly-editable dual-extension file.** `DocumentActionsBar`
   currently downloads the `.md` source; the convenient version downloads the
   generated `.md.html` / `.slides.html` (immediately editable offline, opens in
   its own in-file editor) and accepts it back on Replace — for study guides via
   the block-ID-reconcile path (`importFileAction`), for slides directly. This is
   the inconvenience flagged 2026-07-11.
3. **Full user-content isolation.** Serve all user-authored content from a
   **separate cookieless origin** (belt-and-suspenders over the CSP sandbox in
   decision #8). Infra/DNS decision for the owner.
4. **Carrier-embedded relative→permalink rewrite.** U3 covers plain markdown;
   rewriting refs *inside* a self-contained carrier needs regeneration.
5. **E3 study-guide switchover** to `.md.html` as the committed source of record
   (see Roadmap R1/E3; today it's lean `.md`).
6. **UI polish + minor feature expansions** (general bucket — not now).

### Explicit non-goals

- **Letting an import carry binaries into a trial.** Contradicts the permanent
  text-only-trial policy above.
