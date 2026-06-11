# Alembic Package Contract — v1

**Status:** Normative for v0.1 and later, until superseded by an explicit migration.
**Audience:** Contributors. This is an engineering spec, not educator-facing text.
**Source of truth for implementation:** [`packages/package-contract/src/`](../../packages/package-contract/src/) (pure TypeScript + Zod, no IO) and [`packages/github-bridge/src/`](../../packages/github-bridge/src/). Where this document and the code disagree, the code is current truth and the divergence is flagged here as a **Spec note**.
**Related:** [goal.md](../goal.md) (§4 Package Model, §5 snapshots, §7 dual-extension artifacts) · [InitialReleasePlan.md](../InitialReleasePlan.md) (v0.1 scope) · [docs/spikes/orz-markdown-spike.md](../spikes/orz-markdown-spike.md) (block-ID surface syntax, confirmed).

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in RFC 2119.

---

## 1. Purpose and versioning policy

The package contract is the stable center of Alembic: editors, importers, renderers, the GitHub bridge, the worker tier, and the portal all plug into packages through this contract, never through private knowledge of file layout. The contract — not any editor UI — owns the schema.

Versioning rules:

- Every package MUST record its contract version in the manifest field `schemaVersion`. The current version is `1` (`PACKAGE_SCHEMA_VERSION` in [`manifest.ts`](../../packages/package-contract/src/manifest.ts)).
- Old packages MUST always remain readable. A reader encountering an older `schemaVersion` MUST NOT refuse the package; it reads it under the rules of that version.
- Migrations between schema versions MUST be explicit, logged operations, initiated deliberately and recorded (commit + research event). Silent rewrites of a package to a newer schema version MUST NOT occur — not on open, not on save, not as a side effect of any other operation.
- `schemaVersion` is validated as any positive integer so that v1 code can at least parse-and-refuse-gracefully rather than crash on future manifests.

Within v1, additive, backward-compatible clarifications MAY be made to this document; anything that changes the meaning of existing packages requires v2 and a migration.

## 2. Logical package model: the nine layers

A package is organized into nine layers (`PACKAGE_LAYERS` in [`layers.ts`](../../packages/package-contract/src/layers.ts)). The layer set is closed in v1: tools MUST NOT invent additional layers.

| Layer | Contents | v0.1 |
| --- | --- | --- |
| `study-guide` | The human-readable learning sequence; the conceptual source of truth from which derived artifacts are generated. | Active |
| `concepts` | Concept map data, prerequisites, correlations, learning flow. Stored as structured lists in v0.1 (the visual editor is deferred, the data layer is not). | Active (structured lists) |
| `objectives` | Learning objectives and alignment records. | Active (structured lists) |
| `materials` | Derived and authored teaching materials: slides, worksheets, assignments, discussions, interactives, diagrams, images, charts. | Active (worksheet only) |
| `assessment-support` | Assessment blueprints, public-safe question-template rules, rubrics, evaluation designs. | Reserved (directory exists; question-template system is post-v0.1) |
| `private-instructor` | Instructor notes, answer keys, embargoed assessments, private generated items. **The only private layer.** | Active |
| `provenance` | Source records, attribution, adaptation notes, incident notes, embedded-source hashes (§9). | Active (minimal) |
| `metadata` | Portal record, license status, accessibility status, course context, package structure. | Active (minimal) |
| `research-schema` | Event-log and rubric *schemas* — never sensitive research data. | Reserved (§10) |

Raw AI logs and research event *data* are not package documents in any layer; they live in platform-side storage (Supabase) under data-governance rules.

## 3. Physical storage: the two-repo model

A package is physically stored as a **pair of GitHub repositories** owned by the educator (or an institution/workshop organization):

- the **public repository** (template name `<pkg>-oer`) holds every public layer plus the published static-site source;
- the **companion private repository** (template name `<pkg>-private`) holds the `private-instructor` layer and nothing else layer-wise.

The split is a contract primitive, not an implementation detail, for two reasons stated in [goal.md §4](../goal.md): GitHub Pages on free personal accounts publishes only from public repositories, and Git history is permanent — a private file committed to the public repository even once remains retrievable after deletion.

### 3.1 Layer-to-repo assignment

`LAYER_REPO` in [`layers.ts`](../../packages/package-contract/src/layers.ts) is the single authoritative mapping:

| Repo | Layers |
| --- | --- |
| public | `study-guide`, `concepts`, `objectives`, `materials`, `assessment-support`, `provenance`, `metadata`, `research-schema` |
| private | `private-instructor` |

Each layer maps to exactly one top-level directory of the same name inside its repository (`LAYER_DIR`). The contract classifies paths **only by their top-level directory**; file naming below that level is conventional, not contract-fixed.

### 3.2 The manifest links the pair

The manifest is the file `alembic.json` at the **public repository root**. It is the document that binds the two repositories into one logical package (`publicRepo` / `privateRepo` references, §7). The public-repo copy is the canonical manifest.

> **Spec note:** the root-file allowlist is repo-agnostic in code, so `alembic.json` *could* be committed to the private repository without violating the path invariant. The contract defines only the public-repo copy as canonical; v1 defines no manifest, and no required backlink file, in the private repository.

### 3.3 Allowlisted root files and directories

Paths outside layer directories are fail-closed (§5). Exactly these root entries are permitted, in **either** repository:

| Entry | Kind | Purpose | v0.1 |
| --- | --- | --- | --- |
| `alembic.json` | file | Package manifest (§7) | Active |
| `README.md` | file | Human-readable repo front page | Active |
| `LICENSE` | file | License text matching the manifest `license` | Active |
| `CITATION.cff` | file | Citation metadata, generated with snapshots/DOI | Reserved |
| `.gitignore` | file | Standard Git hygiene | Active |
| `.alembic/` | dir | Platform bookkeeping (§3.4) | Active |
| `.github/` | dir | Committed build configuration / Pages workflow, so forks build independently of Alembic (the no-lock-in test) | Active |

Anything else at the repository root MUST be rejected (`PathLayerError`).

### 3.4 The `.alembic/` directory

`.alembic/` holds **platform bookkeeping that is package state but not educator content**: records the contract needs to persist alongside content yet which belong to no content layer — derived-artifact records (§8), format/version markers, build metadata. Rules:

- Contents of `.alembic/` in the public repository MUST be public-safe (the directory is world-readable there); anything sensitive belongs in platform-side storage or the private repository.
- Tools MUST treat unknown files under `.alembic/` as opaque and preserve them.

> **Spec note:** code currently only *allowlists* `.alembic/` ([`layers.ts`](../../packages/package-contract/src/layers.ts)); nothing writes to it yet. The derived-artifact record location in §8 is this spec's decision for M3 and is not yet pinned by code.

## 4. Repository file layout (worked example)

A small general-chemistry thermochemistry package, `pkg-genchem-thermo`, three study-guide chapters, one generated worksheet.

**Public repository — `genchem-thermo-oer`:**

```
genchem-thermo-oer/
├── alembic.json                          # manifest (§7)
├── README.md
├── LICENSE                               # CC-BY-4.0 text
├── .gitignore
├── .alembic/
│   └── artifacts/
│       └── art-ws-enthalpy.json          # derived-artifact record (§8)
├── .github/
│   └── workflows/
│       └── build.yml                     # committed build config (independent builds)
├── study-guide/
│   ├── 01-energy-and-heat.md             # blocks carry IDs in orz-markdown source
│   ├── 02-enthalpy.md
│   └── 03-calorimetry.md
├── concepts/
│   └── concepts.json                     # structured concept list + prerequisites
├── objectives/
│   └── objectives.json                   # objectives + block alignment
├── materials/
│   └── worksheets/
│       └── enthalpy-practice.md          # generated worksheet, educator-owned after generation
├── assessment-support/                   # reserved in v0.1 (empty, kept by convention)
├── provenance/
│   ├── sources.json                      # source records (§9)
│   └── adaptations.json                  # adaptation notes (§9)
├── metadata/
│   └── portal-record.json                # public-safe portal/discovery record
└── research-schema/                      # reserved in v0.1 (§10)
```

**Private repository — `genchem-thermo-private`:**

```
genchem-thermo-private/
├── README.md                             # explains the repo pair; no manifest here
├── .gitignore
└── private-instructor/
    ├── notes/
    │   └── 02-enthalpy-teaching-notes.md
    ├── answer-keys/
    │   └── enthalpy-practice-key.md      # answer key for materials/worksheets/enthalpy-practice.md
    └── embargoed/
        └── exam1-draft.md
```

Subdirectory names under each layer (`worksheets/`, `answer-keys/`, …) are conventions from the repo templates, not contract requirements.

## 5. The path-level public/private invariant

This is the non-negotiable rule of the contract.

> **Invariant.** Content belonging to a private layer MUST NEVER be staged to, committed to, or otherwise written into the public repository — not even transiently, not in an intermediate commit, not on a branch. Equivalently: every file path in every commit MUST classify (via `layerForPath`) to a layer whose `LAYER_REPO` matches the target repository, or to an allowlisted root entry.

Enforcement is layered (defense in depth), but prevention-before-commit is the primary mechanism; review gates are the backstop, never the front line:

| Enforcement point | Where | Behavior |
| --- | --- | --- |
| Contract validation | `assertPathAllowedInRepo(path, repo)` in [`layers.ts`](../../packages/package-contract/src/layers.ts) | Throws `RepoBoundaryViolation` on a layer/repo mismatch. **No override parameter exists, by design.** |
| Commit-plan validation | `validateCommitPlan(plan)` in [`github-bridge/src/index.ts`](../../packages/github-bridge/src/index.ts) | Every `FileChange` in a `CommitPlan` passes through the contract check before any transport stages anything. Transports MUST call this; there is deliberately no way to skip it. |
| Release gates | publish/registration pipeline (v0.1 Tier-3 gate) | Re-check at publish time and scan public content for answer-key/private markers. Second line of defense only. |

Additional normative rules:

- **Fail closed.** A path that cannot be classified — unknown top-level directory, non-allowlisted root file, empty path, path containing `..` — MUST be rejected (`PathLayerError`). Unclassifiable never means "assume public" or "assume harmless."
- **No bypass.** No API, flag, parameter, environment variable, or admin mode may skip the path check. The deletion case is covered too: a `FileChange` with `content: null` (delete) is validated identically — even *removing* a wrongly-placed path goes through the invariant.
- **Same rule everywhere.** The trial sandbox MUST enforce the identical layer separation so sandbox→GitHub graduation cannot leak. Agent-harness workers (post-v0.1) produce patches that flow through the same `CommitPlan` validation.
- **External edits.** Commits made outside Alembic cannot be prevented; reconciliation detects violations and quarantines the package (publish/snapshot blocked) per [goal.md §5](../goal.md), offering the remediation procedure (§9, incident notes) — never auto-revert.

> **Spec note:** `layerForPath` rejects any path *containing* the substring `..`, which also rejects legitimate filenames like `fig..png`. This is over-strict but fail-closed, hence acceptable for v1; relaxing it would require segment-wise traversal checking.

## 6. Block identity

Stable block identity is a package-contract primitive (it underwrites traceability, drift tracking, adaptation, and provenance), not an editor convenience. Schemas: [`blocks.ts`](../../packages/package-contract/src/blocks.ts).

IDs live **in the plain-text orz-markdown source itself**, so identity survives external edits, round-trips through dual-extension artifacts, and travels with copied content. The canonical surface syntax (confirmed by the [M0 spike](../spikes/orz-markdown-spike.md) against orz-markdown 1.0.0) is the native attrs marker, written with no preceding space:

```markdown
## Acid-Base Theory{{attrs[#blk-abc12345]}}
```

which renders `<h2 id="blk-abc12345">`, deterministically overriding markdown-it-anchor's auto-slug and remaining stable under heading-text edits. Pandoc-style `{#id}` MUST NOT be used — orz-markdown does not support it and it corrupts both the heading text and the slug (spike §3, test A). Tools SHOULD lint imported content for the Pandoc form. The identity rules below are syntax-independent and bind regardless of renderer.

### 6.1 ID format

- A block ID MUST match `^blk-[a-z0-9]{8,}$` (`BLOCK_ID_PATTERN`): the literal prefix `blk-` followed by **8 or more lowercase base36 characters** (`a–z`, `0–9`).
- IDs are generated once, at block creation, and SHOULD be generated with enough entropy that collision within and across packages is negligible.

### 6.2 Identity rules

1. **Immutable.** An ID never changes for the life of its block. Editing a block — including heavy AI rewriting — preserves the ID and bumps the block's monotonic `revision` counter.
2. **Never reused.** A retired ID MUST NOT be assigned to any other block, ever, in any package.
3. **Edit vs. replace.** Editing preserves identity; *deliberately replacing* a block creates a **new ID** with a provenance link to the old one, recorded as `replacesId` on the new block. Delete-then-recreate is replacement, not editing (the v0.1 editor honors this: delete + add = new ID).
4. **Default unit = heading-bounded section.** The default block is the section (`kind: "section"`). Ordinary paragraphs do NOT need individual IDs.
5. **Optional finer anchors.** Addressable sub-elements MAY carry their own IDs with kinds `figure`, `equation`, `structure` (chemical structure), and `question-template-item` (reserved until the question-template system ships). The kind set is closed in v1 (`BlockKindSchema`).
6. **Copy = adapt.** When a block is copied into another package, the copy MUST receive a new ID plus an `adaptedFrom` reference `{ packageId, blockId, snapshot? }` to the source block. This is the basis for block-level attribution and upstream/downstream improvement loops. The `snapshot` field is reserved in v0.1 (snapshots are post-v0.1, §10) but present in the schema so adaptation records can be snapshot-pinned later without a schema bump.
7. **AI preserves IDs.** AI editors MUST preserve block IDs during rewrites (enforced via the orz-markdown Agent Skill in prompts *and* post-generation validation that rejects ID-damaged output).
8. **Validated on every save.** Every save MUST run ID-integrity validation: all IDs well-formed, no duplicates within the package (`validateBlockIds`). A save that fails validation MUST be rejected, not silently repaired.
9. **Imported plain Markdown** without IDs MAY rely on sidecar/content-hash matching only as a temporary fallback until blocks receive native IDs (import pipeline is post-v0.1).

> **Spec note:** `validateBlockIds` currently checks format and intra-package duplication only. Rules 1–2 (immutability across saves, never-reuse across history) are guaranteed by generation-time behavior and the editor's package operations, not yet machine-checked; full enforcement needs an ID-history ledger (a natural `.alembic/` record) and a save-time diff check. Flagged as a v1 implementation gap, not a contract change.

> **Spec note:** `BlockSchema.title` is required (`min(1)`) for every kind, meaning figure/equation/structure anchors must carry a caption or label. [goal.md](../goal.md) does not require this; treat captions-required as the v1 rule unless M2 editor work forces a relaxation.

## 7. Manifest schema (`alembic.json`)

Authoritative schema: `PackageManifestSchema` in [`manifest.ts`](../../packages/package-contract/src/manifest.ts). Readers MUST parse with `parseManifest` (strict Zod validation).

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schemaVersion` | positive integer | yes | Contract version of this package (currently `1`). See §1. |
| `packageId` | non-empty string | yes | Stable platform-wide package ID. **Not** the repo name; survives repo renames/transfers. |
| `title` | non-empty string | yes | Educator-facing package title. |
| `description` | string | no (default `""`) | Short description for the portal record. |
| `discipline` | string | no (default `"chemistry"`) | Discipline tag (chemistry-first, STEM later). |
| `courseContext` | object | no (default `{}`) | All sub-fields optional strings: `courseName`, `level`, `institutionType`. |
| `license` | enum | yes | One of `CC-BY-4.0`, `CC-BY-SA-4.0`, `CC-BY-NC-4.0`, `CC-BY-NC-SA-4.0`, `CC0-1.0`. Closed set in v1; extending it is an additive contract change. |
| `publicRepo` | `{ owner, name }` | no | The public repository, both fields non-empty. **Absent only in sandbox (pre-GitHub) packages**; the graduation flow fills it in when the repo pair is created. |
| `privateRepo` | `{ owner, name }` | no | The companion private repository. Same sandbox rule as `publicRepo`. |
| `createdAt` | ISO 8601 datetime string | yes | Package creation time. |

Example:

```json
{
  "schemaVersion": 1,
  "packageId": "pkg-genchem-thermo-7f3k2m9q",
  "title": "General Chemistry: Thermochemistry",
  "description": "Three-chapter thermochemistry module with worksheet support.",
  "discipline": "chemistry",
  "courseContext": {
    "courseName": "CHEM 107",
    "level": "intro-undergraduate",
    "institutionType": "public-university"
  },
  "license": "CC-BY-4.0",
  "publicRepo": { "owner": "dr-boudreaux", "name": "genchem-thermo-oer" },
  "privateRepo": { "owner": "dr-boudreaux", "name": "genchem-thermo-private" },
  "createdAt": "2026-06-11T15:04:05Z"
}
```

> **Spec note:** [goal.md §4](../goal.md) says "the package manifest links the two repositories"; the optional repo refs are the deliberate sandbox exception from the v0.1 plan, not a divergence (a sandbox package has *neither* repository until graduation — refined during M1). A GitHub-published package MUST have both refs; release gates MUST treat a publish attempt with either ref missing as a failure.

## 8. Derived-artifact records (generate-then-own)

Derived artifacts (v0.1: worksheets; later: slides, assignments, handouts) follow exactly one lifecycle — **generate, then own, with drift tracking**. Bidirectional sync (artifact edits rewriting study-guide blocks automatically) is explicitly out of contract scope.

Every derived artifact MUST have a record capturing:

- **Generation inputs:** the list of study-guide block IDs it was generated from, **and the `revision` of each block at generation time**.
- **Output identity:** the artifact's path in `materials/` and an artifact ID.
- **Status:** fresh, stale, or intentionally divergent.

Lifecycle rules:

1. After generation, the educator owns the artifact and MAY edit it freely without touching the study guide.
2. When any source block's revision moves past the recorded revision, the artifact MUST be flagged **stale**. Staleness is computed from the record; it is never guessed from content diffing.
3. For each stale artifact the educator chooses one of:
   - **regenerate** — replace with a fresh generation from current block revisions, discarding local edits; the record's revisions are updated;
   - **AI-assisted merge** — apply the block changes while preserving local edits, with educator review. *(Deferred past v0.1; the choice set in v0.1 is regenerate / keep-mine only.)*
   - **keep mine** — dismiss the flag; the artifact is marked **intentionally divergent** and the divergence MUST be recorded in provenance (§9). Divergence is legitimate and recorded, never an error.
4. Records live under `.alembic/artifacts/` in the public repository (§3.4) so they survive external edits and rebuildable-projection resets (repos are the source of truth).

> **Spec note:** no Zod schema for artifact records exists in `package-contract` yet; it lands with M3 per the [release plan](../InitialReleasePlan.md). The shape above (block IDs + revisions, status, divergence-to-provenance) is normative for that implementation.

## 9. Provenance records (minimal v1)

The `provenance` layer (public repository) carries the package's attribution and history records. v1 defines four record kinds; all are public-safe by definition of their layer, so they MUST NOT contain private content (e.g., an incident note references *that* a leak occurred and was remediated, never the leaked content itself).

| Record kind | Purpose |
| --- | --- |
| **Source records** | Where material came from: original authorship, imported/uploaded sources, licenses of incorporated material, attribution required by those licenses. |
| **Adaptation notes** | Block- and package-level lineage: `adaptedFrom` context, local rationale ("shortened for a 50-minute class"), and intentional-divergence records from the keep-mine choice (§8). |
| **Embedded-source hashes** | For every exported dual-extension artifact (v0.1: `.md.html`), the hash of the embedded Markdown source plus the embed-format version marker — so a re-imported file can be verified against what was exported ([goal.md §7](../goal.md)). |
| **Incident notes** | Leakage remediation records: when private content reached the public repository and the documented remediation ran (history rewrite, forced re-publication), a note records the incident and remediation in provenance. |

Provenance records MUST support multiple contributors from day one (the multi-author door stays open, [goal.md §4](../goal.md)), even though v0.1 packages have a single owning author.

> **Spec note:** like §8, provenance record schemas are not yet implemented in `package-contract`; v0.1 needs source records and embedded-source hashes at minimum (M4 records the hash on export).

## 10. Out of scope for v1 / reserved

Named here so future versions slot in without disturbing v1 packages:

- **Snapshots-as-tags.** A snapshot is a named, immutable package version implemented as a Git tag, with restore/compare/cite semantics and optional DOI minting ([goal.md §5](../goal.md)). v1 reserves the hooks — `adaptedFrom.snapshot`, the `CITATION.cff` allowlist entry — but defines no snapshot operations. v0.1 ships *restore to a previous save* only.
- **Multi-author.** Roles (co-author, TA-with-private-access, reviewer), per-layer permissions, shared review queues, multi-author citation. v1 keeps the door open (multiple contributors in provenance; no component may assume a single writer) but defines no collaboration semantics.
- **`research-schema` layer contents.** The layer, its directory, and its public-repo assignment exist in v1; the actual event-log and rubric schema formats are unspecified until the research instrumentation design lands. Tools MUST preserve unknown files there.
- **Question-template system.** The `question-template-item` block kind and the `assessment-support` layer are reserved; template-rule formats are post-v0.1.
- **AI-assisted merge** for stale artifacts (§8) and the **import pipeline** ID-fallback (§6, rule 9).
- **Embargo metadata** (auto-release dates, owner-only early lift, [goal.md §7](../goal.md)) — no v1 record format is defined; embargoed material simply lives in `private-instructor`.

A future v2 MUST follow §1: old packages stay readable, migration is explicit and logged.
