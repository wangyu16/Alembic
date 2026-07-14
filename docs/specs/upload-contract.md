# Alembic Package Upload Contract

**The rules a package MUST satisfy to upload, save, and publish in Alembic
without friction** — and the matching guarantees Alembic makes back. This is the
contract between Alembic (the platform) and any package producer: **Coursewerk**,
the `alembic-package` offline-authoring skill, or a human authoring by hand.

It exists because a real Coursewerk-built package (`wikipedia_plate_tectonics`)
uploaded into a blank published project and then failed four ways at
save/publish/preview time. Every rule below traces to one of those failures.
This doc is the single source of truth; keep `packages/package-contract`
(`blocks.ts`, `validate.ts`, `spaces.ts`), `packages/package-ops`
(`release-gates.ts`, `study-guide.ts`), the `alembic-package` skill, and
Coursewerk's `scripts/lib/contract.mjs` + `scripts/check_oer.mjs` in sync with it.

---

## How to read this (Coursewerk architecture mapping)

The rules split the way Coursewerk's own architecture does
(`docs/rules-vs-preferences.md`):

- **HARD RULES (Part 1)** — non-negotiable; a violation makes the package fail to
  save, publish, or render. These belong in Coursewerk's **core** (never a user
  preference) and each carries a **deterministic gate cross-check** that must run
  **even in light mode** (a script check, not an LLM judgment). Each rule lists
  the exact machine check to add to `check_oer.mjs`.
- **Alembic guarantees (Part 2)** — what Alembic does *for* the package, so
  Coursewerk must NOT try to do it (e.g. don't hardcode permalinks).
- **Alembic-side fixes (Part 3)** — failures that Coursewerk rules alone can
  **not** fix; Alembic's ingest path must change. Listed so we don't pretend the
  contract is one-sided.
- **Soft** — everything not below (tone, palette, slide density, worked-example
  count, figure style) stays a user-overridable preference. If a choice can't
  break save/publish/render, it is NOT in this contract.

---

## Part 1 — HARD RULES (a producer MUST satisfy)

### H1 · Manifest
`alembic.json` at the archive root: `schemaVersion` (1 or 2), a `packageId`
(placeholder like `"pending"` is fine — Alembic mints the real one), `title`,
`license` in the enum (H11), `createdAt` ending in `Z`, and an ordered
`chapters: [{slug, title}]`. Each `slug` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
**Check:** parse `alembic.json`; assert required fields + slug pattern + license
in enum. *(Coursewerk already does this.)*

### H2 · Two-repo separation (the invariant)
Instructor-only content (answer keys, full solutions, exam content, private
notes) lives **only** under `private/` (v2) or `private-instructor/` (v1).
Nothing instructor-only in any public folder, and **no public markdown may even
reference a private file**. **Check:** every path routes via `repoForPath`;
scan public deliverables for `private/`-targeted links and for private-signal
phrases. *(Coursewerk already does this; it is also enforced fail-closed by
Alembic's `validateCommitPlan` and `releaseGates`.)*

### H3 · Recognized folders only
Every file sits under a known space — `study-guide/ concepts/ slides/ practice/
assessment-support/ assets/ metadata/ private/` — or is a root-allowlist file
(`alembic.json`, `LICENSE`, `README.md`, `CITATION.cff`, `.gitignore`). Anything
else fails ingest, fail-closed. **Check:** `repoForPath` recognizes every path;
no stray root files. *(Coursewerk already does this.)*

### H4 · Block IDs — the format is exact  ⚠️ *(Bug 2)*
Every section-anchor marker `{{attrs[#blk-…]}}` MUST match:

```
^blk-[a-z0-9]{8,}$      # "blk-" + 8 or more LOWERCASE base36 chars
```

**No hyphens, no uppercase, no underscores, no punctuation** after `blk-`. IDs
must be **unique within the file**. And because Alembic's publish gate currently
requires it, **every `##` section in a study guide must carry one** (see §Part 3
for the gate-relaxation fix; until then, id every H2 section).

- **Why:** Alembic's marker regex is `\{\{attrs\[#(blk-[a-z0-9]+)\]\}\}`. A
  hyphenated id like `blk-hazard-fault` **does not match** — Alembic then
  *silently drops the id* (the section becomes anonymous and the literal marker
  text corrupts the heading). At publish, the release gate reports **"Some
  sections have missing or duplicate identifiers"** (the educator saw "identity
  duplication or absence"); at save, ids are lost. `blk-hazard-fault`,
  `blk-hazard-waves`, `blk-hazard-tsunami` are exactly what broke the real
  package.
- **Coursewerk fix:** generate ids as `blk-` + 8–12 random lowercase base36
  (e.g. `blk-7f3a91c2`), **never** semantic slugs. The skills already say this;
  the AI ignored it, so it must be a **gate cross-check**, not just guidance.
- **Check (add to `check_oer.mjs`, critical, light-mode too):** regex-scan every
  `{{attrs[#...]}}` across `study-guide/`, `slides/`, `practice/`; flag any id not
  matching `^blk-[a-z0-9]{8,}$`, any duplicate within a file, and (for study
  guides) any `##` heading with no marker.

### H5 · Asset references resolve  ⚠️ *(Bug 1)*
Reference every figure with a **relative markdown path into `assets/`** —
`![alt](../assets/foo.svg)` (or with a size suffix `… =520x`) — and the target
file MUST exist under `assets/`. **No remote hot-linked media** (`http(s)://`
image `src`). Do **not** hardcode Alembic permalinks — Alembic assigns them
(Part 2). Every asset is recorded in `metadata/ATTRIBUTION.md` (+ provenance).

- **Why:** relative refs are correct *authoring* form, but they only render if
  something rewrites them to durable links on ingest. (They also must not use a
  path the save-time guard rejects — see Part 3.) A referenced file that isn't
  present, or a remote `src`, renders as a broken image.
- **Check:** every `assets/…` reference resolves to a file on disk; no
  `http(s)://` media `src` in deliverables; every asset file is referenced or
  intentionally course-wide. *(Coursewerk's link audit already checks resolution;
  add the remote-media check.)*
- **NB:** this rule is necessary but **not sufficient** on its own — Alembic must
  also perform the ingest rewrite (Part 3, F1). Both are required.

### H6 · Per-deliverable format contracts
Concept maps + assessment guides are **plain Markdown, no graphics**. Study
guides are rich orz-markdown: learning objectives up top, `##` sections, at least
one worked example in `:::: tabs`, a synthesis, and at least one visual. Practice
sheets have ≥10 Q/Answer pairs in container tabs. Slides are the orz-slides deck
grammar (H8). **Check:** the format-contract audit. *(Coursewerk already does
this.)*

### H7 · orz-markdown syntax is valid
Containers nest with the **outer fence carrying more colons than the inner**, and
**each close matches its open's colon count**; no unclosed `{{plugin}}`; the doc
renders under the pinned `orz-markdown`. **Check:** the container-nesting audit +
a real `orzMarkdown.render()` pass. *(Coursewerk already does this.)*

### H8 · Slides build under the pinned engine  ⚠️ *(Bug 3)*
Decks use the **orz-slides deck grammar**, one `<!-- slide -->` (or `<!-- slide
<layout> -->`) marker **explicitly between every slide**, and MUST build cleanly
under the **same orz-slides version Alembic pins** (currently `^0.8.0`; keep
Coursewerk's `orz-slides` dependency equal to
`Alembic/packages/generators`). **Check:** `build_carriers.mjs` reports
`failed: 0` for every `slides/<slug>.md`, and the `<!-- slide -->` marker count
matches the intended slide count. *(Version parity is the key new obligation —
see Part 3, F3, for Alembic's side of this bug.)*

### H9 · Concept-map path + format  ⚠️ *(Bug 4)*
The course concept map is `concepts/course.md`; each chapter map is
`concepts/<slug>.md`; all **plain Markdown**. **Check:** `concepts/course.md`
exists and every chapter has `concepts/<slug>.md`. *(Coursewerk already emits
this; Alembic must read this path — Part 3, F4.)*

### H10 · Ship lean — no framework carriers
The package contains **only lean sources** (`.md`, and self-contained
`.md.html`/`.slides.html`/`.paged.html` only where they are the intended
artifact). Never commit a *generated* framework carrier of a lean source into the
package — Alembic regenerates those. **Check:** the pack step excludes carriers.
*(Coursewerk already does this.)*

### H11 · License
A `LICENSE` file whose text matches `manifest.license`; the license is one of the
five open licenses (`CC-BY-4.0`, `CC-BY-SA-4.0`, `CC-BY-NC-4.0`,
`CC-BY-NC-SA-4.0`, `CC0-1.0`) or `ALL-RIGHTS-RESERVED`. Discover listing requires
an open license. **Check:** license in enum; LICENSE present + matching.
*(Coursewerk already does this.)*

---

## Part 2 — What Alembic guarantees (do NOT do these in the package)

- **Identity is Alembic's to assign.** `packageId`, document permalinks
  (`/d/{docId}`), and repo coordinates are minted by Alembic on ingest. A
  placeholder `packageId` is expected. Never hardcode a permalink.
- **Relative asset refs become permalinks on ingest.** Author `../assets/foo.svg`;
  Alembic rewrites it to a durable `/d/{docId}` link (see Part 3, F1 — this is the
  guarantee that must be honored on the populate path). Block ids you author are
  preserved verbatim (H4) and are the citation anchors.
- **Carriers are rebuilt.** Alembic regenerates `.md.html`/`.slides.html` from the
  lean source with its pinned orz-family builders; the package ships lean.
- **Binary assets commit as real blobs** when uploaded into a *published* package,
  so images arrive intact.

---

## Part 3 — Alembic-side fixes required (Coursewerk rules can't fix these)

The populate path (`api/populate-package/route.ts` → `planPackagePopulation`)
treats uploaded content as inert bytes — unlike the in-workspace write paths,
which rewrite refs, mint/validate ids, and regenerate through the authoring
engine. These four must be fixed in Alembic for a clean package to work end to
end:

- **F1 · Populate must rewrite relative asset refs → permalinks.** Register
  assets first, then run the existing `rewriteRelativeRefs` / `rewriteMarkdownRefs`
  transform over every committed `.md` before commit (the same transform
  `collection-actions.ts` already uses for insert/replace). Without this, H5-clean
  refs still render broken. *(Fixes Bug 1.)*
- **F2 · Ingest must validate + not silently drop block ids.** `blockFromHeading`
  should surface a malformed/hyphenated id (report it, or normalize on import)
  rather than nulling it and baking the marker into the heading. And the publish
  gate's `allHaveIds` (`release-gates.ts`) contradicts the v2 "anonymous sections
  are legal" rule it cites — relax it to `validateBlockIds`-only so a legitimately
  partial-id guide can publish. *(Hardens Bug 2 beyond the Coursewerk fix.)*
- **F3 · Slides: don't downgrade to a foreign deck engine.** For an authored deck,
  regenerate through orz-slides (the same engine that built it); don't fall back to
  the renderer's incompatible `splitSlides`, and **surface** the swallowed
  orz-slides build error in `hosted-actions.ts` instead of returning
  `editable:false`. *(Fixes Bug 3; versions already match, so the worker path is
  correct — the fallback is the hazard.)*
- **F4 · Concept-map loader must read `concepts/course.md`.** Today
  `loadCourseConceptMap` reads `metadata/course.md` and the structured loader reads
  `concepts/course.json`; neither reads `concepts/course.md`. Unify on
  `concepts/course.md` (+ `concepts/<slug>.md`). *(Fixes Bug 4.)*

Also fix the save-time reference guard's regex gap: `MD_REFERENCE_RE`
(`assets.ts`) doesn't match an image whose target carries a ` =WxH` size suffix,
so sized `../` refs skip the traversal check while unsized ones throw —
inconsistent. Fold this into F1.

---

## The four failures → the rule that prevents each

| Educator-visible failure | Root cause | Producer rule | Alembic fix |
|---|---|---|---|
| Assets not shown / "relative src, not uploaded" | populate never rewrites refs | H5 | F1 |
| "Can't save"; publish "identity duplication or absence" | hyphenated / missing block ids | **H4** | F2 |
| Slide deck stops at a slide | foreign fallback deck engine | H8 (version parity) | F3 |
| Course concept map not extracted | loader reads a different path | H9 | F4 |
