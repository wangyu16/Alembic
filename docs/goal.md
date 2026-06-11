# Alembic Product Vision

**Canonical product name:** Alembic — an open educational resource ecosystem for STEM. The name is the chemist's distillation vessel: raw, messy course materials go in; refined, reusable open educational resources come out.

*Naming note (June 2026): renamed from the working name OASIS-OERE to avoid collision with SUNY Geneseo's established OASIS (Openly Available Sources Integrated Search), a widely used OER discovery service. Known far-field uses of "Alembic" (a Python database-migration tool; a pharmaceutical company) do not overlap with the OER/education space.*

## Abstract: Ultimate Product Goal

Build Alembic as a web platform that lets educators create, adapt, publish, share, and continuously improve rich open educational resources without needing to understand git, GitHub, web publishing, Markdown tooling, document conversion, or software-development workflows. The platform should make educators feel that they are simply organizing knowledge, shaping pedagogy, reviewing AI suggestions, and deciding what is ready to share. Under the surface, the system should perform the developer-like work: structuring content, preserving source files, managing versions, tracking provenance and licenses, generating polished artifacts, publishing through GitHub-backed infrastructure, and making resources discoverable through a central portal.

Alembic is not a textbook editor. It is an educator-friendly environment for building reusable course-resource packages. A package may include study guides, slides, worksheets, assignments, assessment blueprints, question-template rules, quizzes/exams where private or embargoed as appropriate, instructor notes, interactive elements, diagrams, chemical structures, metadata, accessibility records, license/provenance records, and adaptation history. The study guide is the conceptual source of truth: other artifacts are generated from it, remain traceable to it, and may carry instructor-owned local edits that the system tracks as recorded divergence.

Alembic should treat educators as open-source contributors without forcing them to know they are working like developers. Each educator can own and publish resources through their own GitHub account or an institution/workshop-managed account, while the app hides routine GitHub actions behind familiar commands such as save, preview, publish, snapshot, adapt, restore, cite, and share. The public ecosystem should work like open-source software at the infrastructure level: transparent version history, forks/adaptations, attribution, licenses, reusable modules, and community discovery. At the user-experience level, it should feel like a teaching-material workspace designed for busy instructors.

The ultimate purpose is to make high-quality, adaptable STEM OER practical for ordinary educators, especially for advanced, specialized, local, or long-tail courses where traditional OER production is too slow or too centralized. The product should reduce technical burden, support routine customization, preserve instructor control, and help transform scattered private course materials into reusable public resources. Details of implementation can change; this goal should not.

Core ideas are: 1. Let educators to create/maintain OER as developer create/maintain software package using git/GitHub, but without the need to learn Git/Github. 2. platform take care routine Github operations makes educator feels native to edit/manage documents. 3. Educator mainly take care of the knowledge and high level structure, while AI agent is responsible to synthesize high quality public facing teaching documents (markdown based, dual extension self-contained files).

## Requirements

**Requirements:**
- Use orz-markdown (available on npm market) as the markdown parser. This markdown parser is developed by myself. It is deeply customized for scientific/chemistry editing with built-in Agent Skill. When issues are found or improvements/revisions are needed, I can update orz-markdown itself. Alembic's stable block-identity syntax (see Package Model) is implemented at the orz-markdown level, with ID-preservation rules carried in its built-in Agent Skill. orz-markdown follows a backward-compatibility policy: existing syntax never silently changes meaning (deprecate rather than remove), and the dual-extension source-embedding/extraction mechanism is versioned and documented so old artifacts remain extractable indefinitely.
- I have developed vs code extensions for editing dual extension files, such as '.md.html', '.md.pdf', '.slides.html'. They can be found in my GitHub repositories orz-slides-html-vscode, orz-md-pdf-vscode, orz-md-html-vscode. They should be treated as references that ideas can be borrowed from, but do not directly reuse components from them without carefully checking/testing.
- Incorporate https://github.com/epam/ketcher for chemical structure editing.
- Modularized design to make each module can be implemented, tested, maintained independently. Especially, the editing workspace may change more often than other parts, some changes might be fundamental. Make sure the editing workspace can be revised in the future without breaking other parts. Avoid the situation the editing workspace cannot be revised as needed due to restrictions from other parts.  
- Future URL 'https://alembic.orz.how'. The domain name 'orz.how' is hosted at Cloudflare (DNS; optionally CDN).
- Github authentication as default
- Hosting stack: Vercel for the web app, Supabase (Postgres) for platform records and research events, plus a **container worker tier** behind a job queue (Fly.io/Railway/Modal/Fargate-class; vendor not fixed) for long-running jobs: agent-harness runs, PDF generation, and site builds. Serverless platforms alone cannot host the agent harness — workers need minutes-long lifetimes, an isolated filesystem with a checked-out repository, and process sandboxing.


## Product Principles

1. **Educator first.** Every core workflow should be understandable to a non-developer instructor. Technical terms such as commit, branch, fork, pull request, CI, and repository may appear in advanced views, but they should not be required language for ordinary use.
2. **Study-guide centered.** The study guide is the organizing spine. Slides, assignments, question templates, assessments, interactives, and exports should remain traceable to study-guide blocks, concepts, objectives, and learning flow. Centered means the study guide is the authoritative source for generation and traceability — not that every artifact must be byte-derivable from it. Instructor-owned divergence in derived artifacts is legitimate and recorded, not an error.
3. **Source preserving.** Published artifacts should remain adaptable. Markdown source, metadata, provenance, and adaptation logic should survive export and reuse whenever possible.
4. **GitHub powered, GitHub hidden.** GitHub should provide durable storage, transparent history, static publication, and open sharing, while the app handles routine setup, saves, publication, rollback, and adaptation tracking.
5. **AI assists, educator decides.** AI may draft, restructure, generate alternatives, detect issues, and automate repetitive work, but instructor review and approval are required before publication or high-stakes assessment use. Approval attention is risk-tiered (see AI Orchestration Layer) so review effort concentrates where stakes are high — uniform review of everything produces rubber-stamping, which defeats the principle.
6. **Public/private separation.** Student-facing OER, public metadata, and public artifacts must be separated from private instructor notes, answer keys, embargoed assessments, restricted-source notes, raw AI logs, and research records. This separation must be physical — enforced by the storage architecture itself — not merely a publish-time filter.
7. **Adaptation is normal.** Reuse should be possible at many scales: block, figure, equation, interactive, question-template rule, worksheet, file, module, or whole course.
8. **Open does not mean flat.** Hidden planning layers such as concept maps, learning flows, assessment blueprints, and question-template rules may be stored openly when safe, but they do not need to clutter the public student website.
9. **Chemistry first, STEM later.** Chemistry-specific rendering, notation, structures, equations, and diagrams are first-class needs. The architecture should remain extensible to broader STEM disciplines.
10. **Research aware.** The platform should generate the logs and artifacts needed to study authoring burden, customization, reuse, artifact quality, teaching efficiency, and student-facing implementation, while respecting IRB/FERPA/data-governance boundaries.

## Flexible System Architecture

The product can evolve, but the architecture should preserve a few durable domains.

### 1. Authoring Workspace

The authoring workspace is where educators create or adapt packages. It should support:

- course/module setup;
- concept map and learning-flow editing;
- study-guide block editing;
- upload/import of existing materials such as Word, Google Docs, PDF, PowerPoint, images, notes, links, and datasets;
- AI-assisted restructuring of raw materials;
- preview of student-facing pages and instructor-facing materials;
- artifact generation for slides, worksheets, assignments, assessment supports, and interactive elements;
- one-way LMS export (QTI/Common Cartridge) so question sets and packages can land in Canvas/Moodle-class systems — Alembic stays out of the LMS business, but instructors' materials must be able to reach their LMS;
- educator approval checkpoints.

The interface should feel closer to a teaching-material studio than a code editor. Advanced users may open the underlying Markdown or GitHub repository, but that should be optional; the platform treats such external edits as first-class events to reconcile, not anomalies (see External edits and reconciliation). The editing UI should remain a replaceable client of stable package operations; it should not become the hidden owner of the package schema, file layout, Git workflow, renderer behavior, or portal records.

### 2. AI Orchestration Layer

AI agents should operate as assistants with bounded responsibilities:

- extract concepts, objectives, prerequisites, examples, and representations from raw materials;
- co-edit concept maps and learning flows;
- draft study-guide sections;
- suggest local examples, analogies, diagrams, equations, and chemistry structures;
- create slides, worksheets, assignments, and discussion prompts from selected study-guide blocks;
- create question-template rules rather than fixed question pools;
- check accessibility against a named bar (WCAG 2.1 AA), metadata, licenses, attribution, and public/private risks — including generating alt text for chemical structures from their SMILES/molfile representations, a chemistry-first capability generic tools lack;
- support adaptation of blocks, modules, or courses;
- explain changes in educator-facing language;
- maintain provenance and adaptation notes.

**Risk-tiered approvals.** AI changes route through three tiers:

- **Tier 1 — auto-apply, always undoable.** Mechanical, content-neutral work: formatting normalization, broken-link repair, metadata/schema housekeeping, ID-integrity fixes. Applied silently, recorded in a visible changelog with one-click undo. Nothing in this tier may change meaning, content, or public/private status.
- **Tier 2 — batch review.** Content-bearing but low-stakes: drafted sections, restructuring suggestions, generated slides/worksheets, suggested examples and diagrams. Reviewed in a queue with accept/edit/reject; batchable.
- **Tier 3 — mandatory itemized review, never batchable.** Anything crossing a trust boundary: publish, snapshot, portal registration, public/private status changes, license/attribution changes, anything touching assessments or answer keys, and suggest-back submissions to other educators. Each item reviewed individually with an explanation of what changes and why.

Tiers are policy, not hardcode: educators or study administrators may tighten them (e.g., a “review everything” mode), but loosening below tier 3 is impossible — publication always requires explicit approval.

The AI layer should be provider-swappable. Prompts, model versions, and outputs may be logged for debugging and research only under explicit data-governance rules. Raw AI logs should never be published accidentally.

### 3. Agent Harness Integration

For complex repository and document-management tasks, the product should be able to use established AI coding-agent harnesses, such as Claude Code SDK/CLI, Codex CLI, or similar agent workers, rather than relying only on bare model calls. These harnesses should run as controlled backend workers inside the platform — concretely, in the container worker tier (see Requirements), each job in an isolated sandbox with an ephemeral repository checkout — not as tools educators must install, configure, or understand.

Agent harnesses are most useful for tasks that span many files or require repository awareness: reorganizing an OER package, editing a study guide and its derived slides or worksheets together, updating metadata and provenance, regenerating assessment-template rules, checking links and schemas, preparing a readable commit, explaining diffs, and running validation commands. The educator should still see the work as a teaching-material operation, not as a Git or command-line operation.

The harness boundary should be strict. Agents should work in isolated sandboxes or temporary branches, produce patches and explanations, and pass platform validation before anything is published. The app should enforce package schema checks, public/private boundaries, license and attribution rules, answer-key leakage checks, research-data boundaries, and build previews. The instructor should approve meaningful changes before commit or publication. Final GitHub commits, publication, rollback, and permission handling should be performed by the app through its own GitHub integration, not by an uncontrolled agent session.

This design keeps the AI layer provider- and harness-swappable. A future implementation may combine lightweight direct model calls for simple drafting with agent-harness workers for multi-file repository operations, while preserving the same user-facing workflow and governance model.

### 4. Package Model

A course-resource package should include public, private, and metadata layers. A flexible schema may include:

- `study-guide`: human-readable learning sequence;
- `concepts`: concept map, prerequisites, correlations, learning flow;
- `objectives`: learning objectives and alignment records;
- `materials`: slides, worksheets, assignments, discussions, interactives, diagrams, images, charts;
- `assessment-support`: assessment blueprints, public-safe question-template rules, rubrics, evaluation designs;
- `private-instructor`: instructor notes, answer keys, embargoed assessments, private generated items (stored in the companion private repository; see storage architecture below);
- `provenance`: source records, attribution, adaptation notes, revision history;
- `metadata`: portal record, license status, accessibility status, course context, package structure;
- `research-schema`: event-log and rubric schemas, not sensitive research data.

The exact file/folder layout can change, but every package should preserve traceability among concepts, objectives, study-guide blocks, derived artifacts, sources, licenses, and adaptations. The stable center is the package contract and operation API, not any particular editor UI. Future editors, importers, renderers, and file types should plug into the package model through documented manifests and adapters. The contract itself is versioned: every package records its schema version, old packages must always remain readable, and migrations are explicit, logged operations — never silent rewrites.

**Storage architecture: two-repo model.** A package is physically stored as a pair of educator-owned (or institution-managed) GitHub repositories:

- a **public repository** holding the study guide, public materials, public-safe assessment supports, provenance, metadata, and the published static site source;
- a **companion private repository** holding the `private-instructor` layer: instructor notes, answer keys, embargoed assessments, and other private generated items.

The package manifest links the two repositories into one logical package. This split is mandatory, not an implementation detail, for two reasons: GitHub Pages on free personal accounts publishes only from public repositories, so the public repository will be world-readable at the source level; and Git history is permanent, so a private file committed to the public repository even once remains retrievable from history after deletion.

Two enforcement rules follow:

- **Prevention before commit.** The app must enforce public/private separation as a path-level invariant on every commit to the public repository — private-layer content can never be staged there, even temporarily. Publish-time review gates are a second line of defense, not the primary mechanism.
- **Documented remediation.** For the cases where leakage happens anyway, the platform must provide a defined remediation procedure: history rewriting of the public repository, forced re-publication, and a recorded incident note in provenance.

Raw AI logs and research event data are not package documents; they belong in platform-side storage under data-governance rules, not in either repository.

**Block identity.** Traceability, drift tracking, block-level adaptation, and provenance all depend on stable block identity, so it is a package-contract primitive, not an editor convenience. Study-guide blocks — and addressable sub-elements such as figures, equations, chemical structures, and question-template items — carry explicit IDs written in orz-markdown's native syntax. Identity therefore lives in the plain-text source itself: it survives external edits, round-trips through dual-extension artifacts, and travels with copied content. Contract rules:

- IDs are immutable and never reused. Editing a block preserves its ID; deliberately replacing a block creates a new ID with a provenance link to the old one.
- The default block unit is the section (heading-bounded). Finer-grained anchors are optional for figures, equations, structures, and question-template items; ordinary paragraphs do not need individual IDs.
- When a block is copied into another package, the copy receives a new ID plus an `adapted-from` reference to the source block. This is the basis for block-level attribution and for upstream/downstream merging.
- AI editors must preserve block IDs during rewrites — enforced through the orz-markdown Agent Skill — and the platform validates ID integrity on every save.
- Imported plain Markdown without IDs may rely on sidecar/content-hash matching only as a temporary fallback until blocks receive native IDs.

**Derived-artifact model: generate-then-own with drift tracking.** Derived artifacts (slides, worksheets, assignments, handouts, and similar) follow one explicit lifecycle:

- Every derived artifact records which study-guide blocks — and which versions of those blocks — it was generated from.
- After generation, the educator owns the artifact and may edit it freely without touching the study guide.
- When source blocks change, affected artifacts are flagged as stale. The educator chooses per artifact: **regenerate** (replace with a fresh generation, discarding local edits), **AI-assisted merge** (apply the block changes while preserving local edits, with review), or **keep mine** (dismiss the flag; the artifact is marked intentionally divergent and the divergence is recorded in provenance).

Bidirectional sync — where editing an artifact automatically rewrites study-guide blocks — is explicitly out of scope. Mapping artifact edits back to source prose is ill-defined and risks silently corrupting the source of truth. The permitted form of that idea is a suggestion flow: AI may notice an artifact edit and propose a corresponding study-guide edit, which passes through normal educator review like any other AI suggestion.

**Collaboration model.** In v1, each package has one owning author; co-instructors, TAs, and workshop partners are normal cases the design must not foreclose. Colleague collaboration is already supported asynchronously through adapt + suggest-back, which provides reviewable multi-person improvement without co-editing machinery. The package contract keeps the multi-author door open: provenance records support multiple contributors from day one, no component may assume a single writer (the reconciliation rules already guarantee this at the storage level), and GitHub's native collaborator mechanism functions as an advanced, unsupported path because external commits are first-class. Full co-authoring — roles such as co-author, TA-with-private-access, and reviewer; per-layer permissions; shared review queues; multi-author citation — is named future work, not a v1 deliverable.

### 5. GitHub Authentication, Storage, and Publication

GitHub authentication should be the default identity model for the product. Because each educator's GitHub account is also their natural OER storage and publication identity, signing in with GitHub should connect the user's authoring workspace, repository ownership, publication path, version history, attribution, and adaptation/fork history. The educator should not experience this as "becoming a developer"; they should experience it as connecting the account that safely stores and publishes their open teaching materials.

The app may still maintain its own internal user/profile records for roles, consent/status flags, research instrumentation, preferences, and portal metadata, but ordinary sign-in should begin with GitHub. Avoid building a separate email/password identity system as the primary path unless a later institutional requirement makes it necessary.

**Access model.** Identity and repository access are separate grants:

- **Sign-in uses GitHub OAuth for identity only** (profile/email) — connecting an account carries no repository powers.
- **Repository access uses a GitHub App installation scoped per repository.** The App is installed only on the repositories Alembic creates or is explicitly asked to manage, and operates with short-lived installation tokens. Educators can verify that Alembic touches only their Alembic materials, never their other repositories. Adopting a pre-existing repository is an explicit App-installation consent step.
- **Institution/workshop-managed mode installs the same App on the organization.** Commits are made by the App's bot actor but authored as the educator in commit metadata, so attribution survives in history even for educators without personal GitHub accounts.

**Account lifecycle.** Two cases must work by design: an educator leaving an institution takes their packages along via GitHub's native repository transfer (or fork plus provenance note where the organization retains the original); and a package must remain fully usable as a plain Git repository without Alembic — self-describing content, committed build configuration, no platform lock-in. The latter is the honest test of “open infrastructure.”

The default model should be educator-owned or institution/workshop-managed GitHub repositories. The app should handle:

- account connection or managed publishing mode;
- creation of the paired public/private repositories from templates;
- file organization;
- commits/saves with readable history;
- static-site build and preview — builds run **app-side** in the platform worker tier, which pushes built output to the Pages branch, so build failures surface inside Alembic in educator-facing language and the renderer version used is stamped in build metadata; a standard build configuration is still committed to each repository so advanced users and forks outside Alembic can build independently;
- publication through GitHub Pages or equivalent static hosting;
- rollback and version comparison;
- adaptation/fork history;
- license and attribution preservation;
- failure recovery when build or publication fails.

Users should see actions like save, preview, publish, snapshot, restore, adapt, and cite. GitHub-specific details can remain in an advanced details panel.

**Snapshots and citation.** A **snapshot** is a named, immutable version of a package — implemented as a Git tag, experienced as “the version I taught Fall 2026.” Editing continues freely after a snapshot; snapshots can be listed, restored, and compared (“what changed between my Fall 2025 and Fall 2026 offerings?”). Adaptation and citation target snapshots, not moving heads. Citation works at two levels: every snapshot is citable by stable URL and version, and educators may opt in to minting a DOI per snapshot (via Zenodo's GitHub integration or equivalent), with the app generating citation metadata such as `CITATION.cff` automatically. Citable, versioned scholarly output is both good OER practice and a concrete professional incentive for educator adoption.

**External edits and reconciliation.** Because advanced users may edit repositories directly (VS Code, GitHub web, outside pull requests), the app must never assume it is the only writer. Four rules govern this:

- **Repositories are the source of truth.** All app-side databases, indexes, and caches are rebuildable projections of repository content plus platform-side records. On disagreement, the repository wins and the projection is rebuilt. No app component may hold authoritative state that cannot be reconstructed.
- **Detect and absorb, never overwrite.** On sync, the app detects commits it did not make and absorbs them: re-index blocks, re-validate block-ID integrity, re-run release-gate checks, and mark affected derived artifacts stale through the normal drift machinery.
- **No auto-revert; quarantine instead.** If an external change violates an invariant (broken block IDs, schema violations, private content committed to the public repository), the app does not undo the educator's work. It blocks publish/snapshot operations for the package until resolved and offers guided fixes — including the leakage-remediation procedure when private content is involved.
- **Concurrent-edit safety.** App saves commit only against the repository head they last saw; if the repository moved, the app reconciles first rather than force-pushing. The educator sees “your materials were updated outside Alembic — review the changes,” not a Git error.

Important exceptions should remain available: a no-GitHub trial workspace for demos and initial exploration — with a first-class graduation path: when a trial user connects GitHub, the app creates the paired repositories and migrates sandbox content as the initial commits, preserving provenance records accumulated in the sandbox; institution/workshop-managed GitHub organizations for educators who should not publish under personal accounts; and export-only mode for users not ready to publish. These are onboarding and institutional-fit options, not replacements for the GitHub-first durable OER model.

### 6. Portal and Discovery Hub

The app should include a central portal that indexes public-safe metadata rather than centrally owning all OER content. The portal should support:

- search by topic, course level, discipline, package type, license, accessibility status, assessment type, artifact type, and estimated teaching time;
- preview of public packages;
- links to published GitHub Pages sites and source repositories;
- adaptation entry points;
- package quality/status indicators;
- citation and attribution display;
- related-resource recommendations.

**Standards-based metadata.** Published pages should embed LRMI/schema.org `LearningResource` markup, making resources indexable by general search engines and harvestable by existing OER aggregators without going through the portal. The portal itself should consume the same standard metadata rather than owning a proprietary record format — so Alembic resources remain discoverable even independently of the portal.

**Governance and sustainability.** The portal needs the same post-grant sustainability thinking as AI credits. During the funded study, package registration is limited to participants. Opening registration later requires governance: a reporting and takedown path for spam, copyright violations, and miscontent; quality/status indicators that gate prominence rather than censor; and named stewardship of the index (institution, consortium, or community) after the grant. Because published resources live in educator-owned repositories with standards-based metadata, the ecosystem survives even if the portal's stewardship changes hands or lapses.

The portal is a doorway into a distributed ecosystem, not necessarily the permanent host for every resource.

### 7. Self-Contained Editable Artifacts

Dual-extension artifacts such as `.md.html`, `.md.pdf`, `.slides.html`, and related formats should be treated as first-class product outputs. They are rendered files that can be shared like normal HTML/PDF/slides while also embedding editable Markdown source.

Public-facing teaching documents should default to downloadable, editable, self-contained artifact formats derived from public-safe package content. Study guides and chapter notes should be exportable as `.md.html`, slide decks as `.slides.html`, and printable handouts, worksheets, or readings as `.md.pdf` when appropriate. These files should be useful outside Alembic: for example, a student should be able to download a public chapter study guide, open the `.md.html` file in a compatible editor such as VS Code, and keep a private annotated copy with personal notes.

Private or internal documents do not need this artifact wrapper by default. Instructor notes, answer keys, assessment drafts, private planning notes, raw AI logs, and research-only records may remain raw Markdown or structured package records unless a protected private workflow explicitly requires a different export.

The platform should support:

- generating these artifacts from study-guide blocks or derived materials;
- importing them and extracting embedded source where safe;
- tracking embedded-source hashes for provenance;
- marking public, private, embargoed, or restricted-source status — embargoes may carry an auto-release date, and only the owning educator can lift an embargo early;
- preventing answer keys, restricted source excerpts, or private notes from being embedded in public files;
- letting users download/share these files without understanding the technical mechanism.

These artifacts are an important bridge between familiar educator workflows and source-preserving OER adaptation.

**Longevity guarantees (deliberately lightweight).** The embedded Markdown is the source of truth; rendering affects appearance only, so the platform does not maintain re-rendering infrastructure for old renderer versions. Three narrow guarantees protect against actual loss:

- **Extraction never breaks.** Every dual-extension file carries a small format-version marker in its source embedding, and the extraction method is documented and stable. Old files must remain extractable indefinitely; this is the one failure mode that would constitute data loss.
- **Markdown semantics stay backward-compatible.** As an orz-markdown policy, existing syntax never silently changes meaning — deprecate rather than remove, especially for chemistry and equation syntax where semantic drift would render old documents incorrectly rather than merely differently.
- **Renderer version is stamped, not pinned.** Package metadata and generated artifacts record the renderer version for diagnostics only. Because site builds run app-side and built output is committed, the rendered artifact of record is preserved as a file; old snapshots never need re-rendering to know what readers saw.

### 8. Question-Template System

The product should generate and manage question templates, not only question pools. A question template describes how questions should be asked for a concept and context. It may include:

- concept and objective alignment;
- assessment context: homework, quiz, exam, group discussion, in-class activity, reflection, lab, oral explanation;
- cognitive target and difficulty;
- scaffolding rules;
- allowed representations such as text, equation, structure, graph, mechanism, table, or simulation;
- variable parameters;
- misconception targets;
- grading and feedback expectations;
- constraints for answer format;
- public/private status;
- instructor pedagogy notes.

AI can later generate fresh questions from these rules. The generated question may change each time, but it should stay within the instructor-defined assessment design. High-stakes items and answer keys should remain private unless explicitly released.

### 9. Adaptation Workflows

Adaptation should be a primary workflow, not an afterthought. The product should support:

- copy/adapt a single block;
- reuse an equation, image, chart, diagram, chemical structure, or interactive;
- import selected concepts or objectives;
- adapt a worksheet or slide deck;
- adapt a module;
- fork/adapt a whole course;
- remix from multiple packages;
- preserve attribution and license compatibility;
- record local context and rationale for changes.

The user should experience adaptation as normal teaching work: “make this fit my students,” “change the examples,” “shorten for a 50-minute class,” or “raise/lower difficulty.” The system can translate these requests into versioned changes and provenance records.

**Improvement loops.** Adaptation must be a two-way street, or the ecosystem decays into fork-and-forget. Two named workflows close the loop, both built on block identity and `adapted-from` lineage:

- **Pull updates (upstream → adapter).** When a source package changes, adapters are notified in teaching terms (“the package you adapted has 3 updated blocks”). For each adapted block, the system compares upstream and local changes: upstream changed and local untouched → one-click “take update,” batchable; local changed and upstream untouched → keep local; both changed → AI-assisted merge with educator review, or keep local with the divergence recorded in provenance. The educator never sees branches, rebases, or line-level merge conflicts.
- **Suggest back (adapter → author).** An adapter who fixes an error or improves a block can send the change to the original author as a platform-mediated, block-level suggestion. The author reviews it in educator-facing language and the app commits accepted suggestions through normal validation gates. Because suggestions target blocks rather than repositories, they work at every adaptation scale — single block, remix from multiple packages, or whole-course fork. When the lineage maps cleanly to a repository fork, the app may additionally materialize the suggestion as a GitHub pull request for outside-world transparency.

Direct GitHub pull requests from users outside Alembic remain possible on public repositories; the platform should absorb them through its normal external-change reconciliation rather than ignore them.

### 10. Research and Analytics Layer

Because the platform is also an IUSE intervention, it should be instrumented from the beginning. Possible research-support data include:

- time to create usable package/artifact;
- number and type of authoring steps;
- AI suggestions accepted, rejected, or edited (tier-1 auto-applies logged as a separate category, so acceptance-rate metrics reflect human decisions only);
- reuse/adaptation events;
- publication and revision history;
- technical help requests or error events;
- package completeness;
- artifact quality rubric records;
- accessibility/license/provenance status;
- question-template creation/use;
- instructor-reported workload and teaching-efficiency indicators;
- student-facing page/activity usage where IRB-appropriate.

Research logs should be separate from public repositories and private instructor content. The product should make export to de-identified CSV/JSON possible for the evaluator/research team, but it should not assume all operational logs are research data.

### 11. AI Credit and Sustainability Model

During the funded study, normal participants should not need to buy AI subscriptions, create API keys, or pay for model usage. The platform should provide centrally managed AI credits funded by the project so every participating educator receives the same intervention, with consistent model access, logging, rate limits, approval gates, and support. This is important both for usability and for research validity: participant cost, account setup, and model differences should not become hidden barriers or confounds.

After the grant-supported study, the software can remain open source while AI inference remains an operating cost. The product should therefore support multiple future credit models without changing its core architecture:

- institution-managed API billing for departments, libraries, teaching centers, or consortia;
- individual bring-your-own API keys for advanced users;
- hosted service tiers that pass through AI usage costs transparently;
- limited community/free credits supported by grants, sponsors, or institutions;
- local or open-weight model options where quality, privacy, and cost tradeoffs are acceptable.

Design implication: the AI provider and billing layer should be modular. Educators should experience one authoring workflow, while administrators can choose who pays for model calls, what models are allowed, what quotas apply, and what data-governance rules control prompts, outputs, and logs. The open-source platform should not promise free AI usage forever; it should make the cost visible, configurable, and sustainable.

## Suggested Module Map

The implementation may choose different frameworks, but the product can be thought of as these modules:

| Module             | Purpose                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| App Shell          | Navigation, workspace layout, route structure, common UI state                                       |
| Workspace/Auth     | User identity, account state, consent/status flags, GitHub connection, workspace selection           |
| Package Builder    | Course/module setup, study-guide blocks, concept maps, objectives, learning flow, package operations |
| AI Assistant       | Ingestion, drafting, restructuring, question-template generation, checks, adaptation suggestions     |
| Artifact Renderer  | Markdown parsing, chemistry rendering, HTML/PDF/slides generation, dual-extension artifact handling  |
| GitHub Bridge      | Repository setup, saves/commits, template management, builds, Pages publication, rollback            |
| Sync/Reconciliation | Detect external commits, rebuild projections, re-validate invariants, drift marking, publication quarantine |
| Agent Workers      | Job queue, sandboxed containers, ephemeral repo checkouts, harness execution, PDF/site builds, patch + explanation output |
| Portal/Search      | Public metadata index, search/filter, package preview, adaptation entry points                       |
| Adaptation Engine  | Import/reuse/fork/remix workflows, upstream update merging, suggest-back flows, attribution and license preservation |
| Assessment Support | Blueprints, question-template rules, rubrics, public/private assessment boundaries                   |
| Provenance/License | Source records, license compatibility, attribution, adaptation lineage, release gates                |
| Research Export    | Event logging, artifact IDs, rubric exports, de-identified study exports                             |
| Admin/Operations   | Component status, error monitoring, data-governance settings, demo/test content management           |

## Flexible Development Guidance for Vibe Coding

Start by making one coherent workflow work end to end with honest labels for what is real, mocked, manual, or experimental. The first useful version does not need every module to be complete. It should demonstrate the core product idea:

1. create or import a small chemistry/STEM module;
2. outline concepts and the study guide as a structured list — the `concepts` layer exists in the data model from day one, but the visual concept-map editor is deliberately deferred;
3. edit study-guide blocks in the browser;
4. generate at least one derived artifact such as slides, worksheet, or question-template rules;
5. produce at least one dual-extension editable artifact;
6. preview a public-safe student-facing page;
7. save/publish through the two-repo GitHub flow or a clearly labeled sandbox path;
8. register public metadata in a minimal generated index page only after release-gate checks — the searchable portal UI (search, filters, previews, recommendations) is deliberately deferred until multiple real packages exist to discover;
9. record basic research events;
10. show public/private separation for instructor materials and assessments.

Deliberately **not** trimmed from the first version: GitHub publishing and the dual-extension artifact (they are the thesis), the two-repo public/private invariant (it must exist from the first commit — retrofitting it is the leakage scenario), and basic research events (instrumentation-from-the-beginning is a study commitment, and events are cheap). The validation target: if this loop feels magical to one non-developer chemist, the product thesis holds.

After that, expand by strengthening the weakest workflow rather than following a fixed feature list. The product should always remain aligned to the ultimate goal: educators focus on knowledge, pedagogy, and steering; the platform handles structure, production, publication, provenance, and reuse.

## Boundaries and Non-Goals

The initial product should not become:

- a full LMS;
- a gradebook;
- a student discussion platform;
- a general-purpose GitHub client;
- a generic AI chatbot;
- a closed central content warehouse;
- a high-stakes assessment delivery system;
- a replacement for instructor judgment;
- a PESOSE-style governance/security research platform.

Those directions may inspire later integrations, but the IUSE product should remain an educator-facing OER authoring, adaptation, publication, and research-intervention platform.

## Success Definition

The product succeeds if a non-developer educator can start with a teaching idea or messy existing materials, collaborate with AI to shape the knowledge flow, create a study-guide-centered resource package, generate polished and editable artifacts, publish/share through open infrastructure, adapt others' materials with attribution, and retain control over what is public, private, or research-only. The system should make the open-source-style OER ecosystem feel natural to educators while preserving enough structure, metadata, provenance, and instrumentation for high-quality research and long-term reuse.