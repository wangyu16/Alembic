# Decision Log

Dated record of concrete decisions — what was chosen, what is permanent by
design, and what is deferred to the future. Complements [Status.md](Status.md)
("what is done") with the "why" and the forward plan. Newest entry first.

---

## 2026-08-28 — AI gateway: self-hosted LiteLLM on the owner's Oracle VPS (Portkey superseded)

**Decision.** The gateway control plane is **self-hosted LiteLLM**, deployed on the owner's Oracle Cloud
Always-Free A1 VPS first (may move to an always-on Fly machine later — a config-only `AI_GATEWAY_URL`
swap; `GatewayProvider` is OpenAI-compatible, so no code changes either way). Talking **directly to
providers** (no middleman fees); optionally OpenRouter behind it for long-tail models.

**Why.** The requirement is a *control plane*, not a marketplace: per-job **virtual keys with hard
budgets** (load-bearing under the platform-key model), per-user attribution, and full data-flow custody
(the FERPA/IRB argument that originally motivated Portkey). LiteLLM meets all of it at $0 license cost.
**Portkey (chosen 2026-06-16) is superseded:** acquired by Palo Alto Networks (2026-05) and folded into
the Prisma AIRS enterprise security platform — no longer a fit for a free, solo-operated platform.

**Operating rules (recorded in [specs/worker-tier.md](specs/worker-tier.md) §1.5):** Oracle tenancy
upgraded to PAYG (removes Always-Free idle reclamation); Cloudflare proxy/tunnel in front; LiteLLM state
in Supabase Postgres; deployment-as-code so a dead instance is a ~10-minute redeploy anywhere;
direct-provider fallback in the web app as the degraded mode; provider keys live only on the gateway
host. Capacity note: a LiteLLM proxy is I/O-bound — the A1 shape (4 OCPU/24 GB) is far beyond any
plausible load; the risks are account/instance lifecycle, hence the rules above.

---

## 2026-08-28 — Worker tier: agent lane on Fly, platform-key model, no BYO

**Decision.** Recorded in full in [specs/worker-tier.md](specs/worker-tier.md). Summary:

| # | Decision | Why |
|---|---|---|
| 1 | **Platform provides the AI key; the BYO-key promise is removed** (goal.md §11 amended; 2026-07-12 "BYO-key / sponsored / paid credits" messaging superseded to sponsored/paid credits only). | Kills key-vault UX and "subscription ≠ API key" confusion; the platform controls model choice, routing, logging, and cost attribution uniformly. Consequence accepted: metering + **hard per-run budget caps become required-before-launch** — every runaway loop is now the operator's bill. |
| 2 | **Tier split confirmed:** local single-file editing = direct LLM calls with designed system prompts (no agent SDK); package-level work = coursewerk as an agent in the worker tier. Registry gains `execution: "call" \| "agent"`. | The 90% case stays cheap and serverless; the harness is reserved for genuinely multi-file, repo-aware work (ai-architecture.md's Tier A/B, now firm). |
| 3 | **Agent lane = Fly (Sprites or Machines — spike pending) running the identical harness local coursewerk uses**; non-AI jobs stay on the existing Fly worker; queue in Postgres. | Parity (local run ≡ hosted run, one coursewerk codebase), one already-operated vendor, persistent-sleeps-idle sandboxes match coursewerk's ⏸-gated staged pipeline, compute cost is noise vs tokens. |
| 4 | **Sandbox never holds the master key:** per-job short-lived gateway virtual key with a hard budget; egress allow-listed. | Exfiltration impossible by construction; the per-run cap is enforced outside the agent. |
| 5 | **Job outputs are files/changesets, never commits** — validation (import gate, leakage, near-verbatim) → tiered review → `packageOps` → `github-bridge`. | goal.md §3 verbatim; the agent produces, the platform commits. |
| 6 | **Watch list, not churn:** Anthropic Managed Agents re-evaluated at GA or ~2 quarters. Owner posture: no switching within ~a month of adoption; the area changes fast, so no choice here is forever — switch when the benefit is significant. The harness seam keeps any switch a swap, not a rework. | Managed Agents is the only option deleting harness ops entirely (hard per-session dollar caps fit the platform-pays model) but is beta and would fork coursewerk off the local CLI harness. |

**Open (under evaluation, tracked in the spec §3):** harness selection (Claude
Code / Agent SDK vs minimal pi-class harnesses vs others), the cost-efficient
model mix (flash-class drafting + different-family mid-tier critique),
Sprites-vs-Machines spike. *(The gateway question was resolved the same day —
see the entry above.)*

**Ruled out (dated):** GitHub Actions as job runner (key exfiltration —
permanent); Cloudflare Sandbox (disk resets on sleep); Modal (premium,
GPU-oriented); E2B/Daytona/Vercel Sandbox (capable, but no advantage over the
operated Fly footprint — revisit with the market).

---

## 2026-08-28 — Educator version contract ("just enough git") adopted

**Decision.** Version control for educators is now an explicit, closed contract:
[specs/educator-version-contract.md](specs/educator-version-contract.md). Twelve
educator verbs (Save, Preview, Publish/Update page, Snapshot, History, Restore,
Pin/Cite, Share a file, Adapt, **Propose a correction**, **Update from source**,
Reconcile) with their Git translations — and a permanent exclusion list
(branch, merge, PR, commit message, rebase/rewrite, staging), each with an
educator-facing replacement.

**Key rulings (with rationale):**

| # | Ruling | Why |
|---|---|---|
| 1 | **Closed list, both directions.** Capabilities need an educator-workflow justification; exclusions are design, not deferral. | "Just enough" is only real if the boundary is written down; otherwise Git concepts leak back in one feature at a time. |
| 2 | **Two-pointer model instead of branches.** One linear history; working head (Save) + publish pointer (Publish/Update page). | The only real branch pressure is draft-vs-live during a running term; a movable publish pointer answers it completely. Terms are covered by Current-term + snapshots. |
| 3 | **No merge commits, ever.** Divergence (three doors) resolves by keep-mine / take-theirs / AI-assisted merge → one forward commit. | Merge UX is developer UX; AI-assisted merge (block anchors assisting) is the educator's merge tool. |
| 4 | **History is docId-keyed; the registry (R2) is the version index.** Git is storage; SHAs are never educator-facing. | Path-filtered history severs on rename/move. This elevates R2 from discovery plumbing to a version-control requirement. |
| 5 | **Lean `.md` committed source is permanent** — amends Roadmap R1/E3: the ".md.html as committed chapter source" target is dropped; the in-file editing UX proceeds on generated surfaces, and dual-extension uploads are absorbed by extracting embedded source. | Meaningful diffs/history and the no-lock-in legibility promise both require lean sources; committing carriers would bury content changes under framework bytes. |
| 6 | **PR → "Propose a correction"; upstream flow → "Update from source".** Suggest-back acceptance is itemized (never batched), applied as a forward commit with attribution. | These two verbs are what the vision's decentralized-improvement story (CA/NY adaptation, correction upstream, benefit to later users) actually needs; they were implicit before. |
| 7 | **History rewrite stays forbidden as an educator verb**, with one named exception: leakage remediation as an operator-run emergency procedure ([specs/leakage-remediation.md](specs/leakage-remediation.md)). | "Every change is kept" is the core promise; the exception is recorded so it can't quietly widen. |

**Verified against the vision** (the bridge: familiar verbs ↔ automated Git
operations; educator-controlled repos; decentralized improvement; share modules
as ready) — coverage table in the contract §8. Gaps the check surfaced and
fixed: Publish-as-pointer, Propose-a-correction, and Update-from-source were
missing from the earlier draft primitive list.

**Open (recorded in the contract §9):** trial→published history carry-over;
suggest-back UX lands with Module T; multi-author live collaboration out of
scope.

---

## 2026-07-12 — Licensing tiers, copyright-by-provenance, free platform / metered AI

**Decision.** License and copyright-cleanliness are **separate axes**, gated independently:
- **License** (the reuse grant): a package carries an **open license** (CC-BY/-SA/-NC/-NC-SA/CC0) *or* the
  new **`ALL-RIGHTS-RESERVED`** value (unlicensed). Open is required to **list on Discover**; ARR packages
  are created, published to their own site, and used for a class, but are **not listable**.
- **Copyright-cleanliness** (the right to distribute): required for any **public** publish (own site or
  Discover). Handled by **positive provenance** — every asset must *prove* a clean origin (self-generated or
  open-licensed with a captured source); "if you're not sure where an image came from, don't use it." The
  platform can't *detect* infringement, so it requires *proof of clean* instead. Text must be original prose
  (facts aren't copyrightable, expression is); coursewerk's near-verbatim scan flags copied passages.

**Enforcement.** `registerPackageAction` hard-requires open-license + **educator copyright attestation**
(recorded in the event log — no migration). Publish + List-publicly confirms carry an **attest + warn**
prompt; own-site publishing stays allowed (educator's responsibility, per owner). Adaptation is disallowed
for/into ARR. Verified: typecheck + 449 tests + web build.

**Why.** Coursewerk is optional/non-mandating — instructors may keep packages private (no license needed).
Making license optional (via ARR) lets private/own-class use coexist with an open, verified Discover market.

**Platform economics (owner note).** The **platform is always free and open**; the **AI assistant is the
metered part** (BYO-key / sponsored / paid credits) so the owner is never liable for thousands of users' AI
costs. Near-term: a *messaging* pass declaring this. Deferred: the actual metering machinery on the existing
entitlement seam (no billing UX yet).

## 2026-07-11 — Two-tier course model (blueprint vs. course) + coursewerk

Owner clarification of the product's mental model, refining the guide framing.

**A course has two tiers:**

1. **The blueprint (the plan / true spine).** Concept maps + assessment guides —
   plain text, concise, easy to maintain. They define *what* is taught, how
   concepts correlate, the learning objectives, and *how* each is assessed. This
   is the layer **instructors work in** ("the high ground" — planning).
2. **The course materials (public-facing, assembled products).** Study guide,
   slides, practice, quizzes, exams — rich structure, layout, visual design. They
   are **assembled from the blueprint, largely by AI agents + agent skills**,
   which handle the editing (accuracy, accessibility, copyright, structure,
   format, layout) far more reliably than hand-editing. **The study guide is the
   center of this tier** (the other public docs organize around it and stay
   traceable to it).

**Consequences / decisions:**

- The earlier "the study guide is the spine" framing was imprecise — it
  conflated the tiers. Correct framing: *instructors plan the blueprint; AI
  assembles the course around a central study guide.* The `/guide` content was
  reframed to **Blueprint → Course** (owner-chosen labels), with a new
  `BlueprintFigure` (plan → AI → course).
- **Every file has a markdown source of truth**, editable in the Alembic
  workspace **or** downloaded and edited locally — the same document either way.
- **coursewerk** is the owner's pipeline that drives an AI agent to produce a
  *complete, uploadable* course package. It is the **upstream author** of exactly
  what Alembic ingests: the [`alembic-package` skill](../.claude/skills/alembic-package/SKILL.md)
  + `importPackageFromFiles`/`/api/import-package` are its downstream landing
  contract. The guide names coursewerk explicitly (owner-approved).
- This does not contradict goal.md: Principle 2 ("study-guide centered") applies
  to the *course-materials* tier; Principle 8 ("open does not mean flat —
  concept maps, blueprints as planning layers") is the *blueprint* tier.

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
