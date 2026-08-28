# Educator Version Contract — "just enough git"

**Status:** adopted (owner decision, 2026-08-28).
**Related:** [goal.md](../goal.md) (principle 4 "GitHub powered, GitHub hidden";
the bridge figure), [package-contract-v2.md](package-contract-v2.md) (registry),
[Roadmap.md](../Roadmap.md) Modules R/P/T,
[self-contained-editing.md](self-contained-editing.md),
[SteeringNote.md](../SteeringNote.md) §3/§3b,
[DecisionLog.md](../DecisionLog.md) 2026-08-28 entry.

## 1. Purpose and ruling principles

Software teams never lose work because every change is version-controlled; the
tools that make that possible (Git/GitHub) are famously hard to learn. Alembic
is the bridge: educators use familiar teaching verbs, and the platform
translates each into the technical operations a developer would do by hand.

Teaching documents are not software packages, and not all Git features are
needed. This contract is the **closed list** of version-control capabilities
Alembic provides — deliberately smaller than Git — plus the list of Git
concepts that are **never surfaced**, each with its educator-facing
replacement.

Two ruling principles:

- **Just enough.** Every capability below traces to an educator need in the
  product vision. Nothing is exposed merely because Git has it; nothing is
  added to this list without an educator-workflow justification.
- **No lock-in.** The underlying repositories remain *ordinary* Git
  repositories, controlled by the educator and legible without Alembic: plain
  files, lean markdown sources, one linear history per repo, standard tags.
  An educator who leaves the platform loses nothing — their history, files,
  and published site all still work.

## 2. The verbs (the closed list)

| Verb | Promise to the educator | Under the hood |
|---|---|---|
| **Save** | "A permanent version of each change is recorded." | Commit to the working head (auto-generated readable message; optional educator note; optional `changeKind` tag). Trial packages: dated version in platform storage. |
| **Preview** | "See the course as students will." | Renders the working head via generated surfaces. No version consequence. |
| **Publish / Update page** | "The student site changes only when I say so." | Moves the **publish pointer** (§4): builds and deploys the site from the working head. Tier-3 explicit action. Re-runnable ("Update page"). |
| **Snapshot** | "Preserve a named version of the whole course — 'Fall 2026'." | Git tag; pins every file in the package at once. |
| **History** | "See a file's past versions, by date, even after renames." | Per-file dated version list, **docId-keyed** (§6), curated with `changeKind` tags. The registry is the index; Git is the storage. |
| **Restore** | "Return a document to an earlier version." | Writes the chosen version **forward** as a new save. Never rewinds or rewrites history; one file restores independently. |
| **Pin / Cite** | "Reference exactly this version, forever." | `file@version` (content hash) or `@snapshot` (package tag); immutable, citable permalinks. |
| **Share a file** | "Share one module/element when it's ready." | Per-file discoverability + permalink (Module P). Explicit opt-in; requires metadata; `private` never, `current/` never. |
| **Adapt** | "Take this course (or file) and make it my own; stay connected to the original." | Fork (whole package) or per-file copy; lineage via `adaptedFrom`; the adaptation is a complete, independent course with its own history. |
| **Propose a correction** | "Send my fix to the original author, who may accept it." | Suggest-back: a file-level change offered into the author's review surface; acceptance applies it through `packageOps` as a forward commit **with attribution**. The educator-facing replacement for a pull request. Itemized review — never batch-applied. |
| **Update from source** | "When the original improves, I choose: update, keep mine, or go my own way." | Pull-updates on adapted content: take / keep / switch-to-fork, with AI-assisted merge when both sides changed (block anchors assist). |
| **Reconcile** | "Editing my files outside Alembic is normal, not a problem." | Direct GitHub commits / uploads are first-class events: detected, validated, registered identically to in-app edits (origin parity), surfaced for review when content-bearing. |

## 3. Never surfaced (permanent exclusions, with replacements)

| Git concept | Why excluded | Educator-facing replacement |
|---|---|---|
| Branch | Teaching workflows don't need concurrent divergent lines | Publish pointer (§4) for draft-vs-live; snapshots for named states; fork for true divergence |
| Merge / conflict resolution | Merge commits and conflict markers are developer UX | Divergence policy (§5): choose-or-AI-merge, recorded as one forward commit |
| Pull request | Requires Git mechanics from the proposer | **Propose a correction** (platform-mediated, attributed) |
| Commit message | Authoring burden with no educator value | Auto message + optional note + `changeKind` tag; the registry's version list is the curated history |
| Rebase / history rewrite | "Every change is kept" is the core promise | Forbidden. Restore writes forward. *(Sole exception: leakage remediation may require a history rewrite as an **operator-run emergency procedure** — see [leakage-remediation.md](leakage-remediation.md). It is never an educator verb.)* |
| Staging / index | No partial-commit need | Save is atomic |
| Cherry-pick, stash, submodules, detached HEAD, … | No educator equivalent exists | None needed |

These are exclusions by design, not deferrals. Adding any of them back requires
revisiting this contract, not a feature ticket.

## 4. The two-pointer model (draft vs live)

Each repo has **one linear history** and two pointers:

- the **working head** — advances on every Save; Preview reads it;
- the **publish pointer** — advances only on Publish / Update page; the
  student site is built from it.

This is the complete answer to draft-vs-live pressure (e.g. revising mid-term
while the live site stays stable) — no branches, ever. Term-over-term
workflows are covered by Current-term archiving plus snapshots. The registry
records the published state (synced/published SHA) so "site is behind your
latest save" is a displayable fact, not a surprise.

## 5. Divergence policy (no merges, ever)

Edits can arrive through three doors (workspace, upload, direct GitHub
commit). When Save detects the remote head has moved since last sync:

1. show the difference in plain language (per file);
2. the educator chooses: **keep mine** / **take theirs** / **AI-assisted
   merge** (optional block anchors assist the merge);
3. the result is recorded as a single **forward commit**.

No merge commits ever appear in educator repositories. The same policy applies
at every door. Live concurrent co-editing of one package is out of scope
(single-educator ownership; external edits are serialized through this policy).

## 6. Version identity

- The **registry (Module R2) is the version index**: docId-keyed history
  (survives rename/move — identity travels with the file via the embedded
  carrier `uid`), content-hash version ids for pinning, path-change records,
  tombstones for deletions. This makes R2 a *version-control requirement*,
  not only discovery plumbing.
- Git SHAs, refs, and tags are storage implementation; they are never
  educator-facing language.
- Versions are curated for display by date + `changeKind`; the raw Git log is
  an implementation detail nobody is expected to read.

## 7. Dependencies and consequences

- **Lean committed sources (permanent).** Meaningful per-file history and
  diffs — and the no-lock-in legibility promise — require the committed
  source of record to be lean markdown (`.md`), not the dual-extension
  carrier. `.md.html` / `.slides.html` / `.paged.html` are **generated
  editing/viewing surfaces**; uploading an edited dual-extension file is
  absorbed by extracting its embedded source at the registration door. This
  confirms the lean-source model (Status.md, 2026-07-08) as permanent and
  **amends Roadmap R1/E3**: the ".md.html as committed chapter source"
  target is dropped; E3's in-file editing UX proceeds on generated surfaces.
- **Trial parity.** Trial packages get the same verbs with platform storage
  as the backend (dated saves; text-only per the trial-storage policy).
- Unchanged and referenced, not redefined here: the two-repo invariant,
  `packageOps` as the single write path, Tier-3 approval for
  publish/registration/suggest-back.

## 8. Vision coverage check

| Vision claim | Verb(s) |
|---|---|
| "Every change is kept… never losing work" | Save, History, Restore (forward-only), no-rewrite rule |
| Save / Preview / Publish / Snapshot / Restore | The five verbs, verbatim |
| "Repositories controlled by the educator, not locked inside Alembic" | No-lock-in principle (§1), lean sources (§7), Reconcile |
| Public materials separated from private instructor resources | Two-repo invariant (referenced) |
| Independent local adaptations, connected to the original | Adapt (lineage), Update from source |
| "Propose the correction to the original author, who may accept it" | Propose a correction |
| "…for the benefit of all later users" | Update from source (take/keep/switch-to-fork) |
| "Share individual modules as they become ready" | Share a file, Pin/Cite |

## 9. Open questions

- **Trial → published history carry-over:** publishing graduates the current
  content into fresh repos; whether prior trial versions migrate into
  Git-visible history or remain platform records is undecided.
- **Suggest-back / notices UX** lands with Module T (Inbox); the contract
  fixes only the semantics (itemized, attributed, forward commit).
- **Multi-author live collaboration** on one package: out of scope for this
  contract; revisit only with a real institutional need.
