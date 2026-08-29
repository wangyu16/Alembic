# Blind-critique round 1 (partial) — public surfaces only

**Date:** 2026-08-28. **Scope:** the unauthenticated ~25% of the acceptance
spec. Two context-denied agents, given only the product promise, the item
list in user language, and live URLs — no source, no docs, no history.
Read-only: no sign-in, no mutation.

**Subject:** the owner's real course — *General Chemistry*, 19 chapters,
333 files, 21.8 MB — published at
`wangyu16.github.io/genchem-u35f0f11-oer/`.

**Not covered** (needs a staging environment): everything behind sign-in —
create, edit, save, versions/restore, upload, replace, adapt, AI. See
[../rounds/README.md](README.md).

---

## D5 — private material never reachable from anything public: **HOLDS**

The hardest promise in the product, tested from the outside by an agent that
does not know how the code works:

- **D5a — public repository:** every path that has *ever* existed across all
  17 commits enumerated (`git log --diff-filter=A`). No `private/`,
  `private-instructor/`, answer-key or teaching-notes directory has ever been
  committed, **not even transiently**. Every privacy-grep hit was a false
  positive (the chapter *Physical Properties of Solutions* matching
  "solutions").
- **D5b — page content:** all 58 deployed pages scanned, including HTML
  comments, embedded JSON, and the embedded markdown source. No answer keys,
  no speaker notes, no link into the private repo. Secret scan (tokens, JWTs,
  API keys) and email scan: **zero hits**. Verified the embedded source is
  byte-identical to the public repo — nothing is injected at build time.
- **D5c — private repo:** anonymous 404 on all four access paths (API, web,
  tree, Pages).
- **Deployed branch is a strict subset** of public content: 60 files —
  `index.html`, `build-info.json`, `.nojekyll`, and 19 each of chapters /
  practice / slides. `assessment-support/`, `concepts/`, `metadata/` and
  `alembic.json` all 404 on the site.

## FINDING 1 — the published site is NOT platform-independent (contradicts a core promise)

**Severity: high — it falsifies a stated product guarantee.**

The `gh-pages` branch contains **zero asset files**. All **157** figures on
the live site are `<img src="https://alembic.orz.how/d/doc-…">` — verified
independently: a single chapter page carries 9 such references and no
relative asset reference at all.

This contradicts [storage-and-write-paths.md](../../specs/storage-and-write-paths.md)
§1 — *"An educator who leaves the platform loses nothing — their history,
files, and published site all still work"* — and goal.md's no-lock-in
position. Today nothing is broken (all 157 return 200). But:

1. **If `alembic.orz.how` goes away, every figure on every published course
   breaks.** The source images are safe in `assets/` on `main`, so the site is
   *rebuildable* — but the published site is not self-sufficient, which is
   what the promise says.
2. **Every student loading a course page pings the platform.** For a research
   platform with FERPA/IRB obligations, that is student traffic arriving at
   the operator's infrastructure as a side effect of publishing — worth a
   deliberate decision, not an accident of the permalink rewrite.
3. **The operator serves all image bandwidth for every published course**, in
   perpetuity, for free.

**Cause:** the U3 relative→permalink rewrite is right for *portability of the
markdown* (references survive moves and downloads) but wrong for the
*published site*, which should reference assets it carries itself.

**Fix:** at site-build time, copy referenced assets into `gh-pages` and
rewrite those permalinks to relative paths. Trade-off to decide: it adds the
asset bytes to the published branch and lengthens publish.

## FINDING 2 — `alembic.json` publicly names the private repository

**Severity: low.** The public manifest carries
`"privateRepo": {"owner":"wangyu16","name":"genchem-u35f0f11-private"}`.
Existence and name only — no content, and the file is not served on the site
(404). Still, it tells any reader that a private repo exists and what it is
called. Consider omitting `privateRepo` from the public copy of the manifest.

## FINDING 3 — instructor-oriented material is public by design (owner's call)

**Not a boundary failure — a product question.** The 19 `assessment-support/`
files are in the public repo, README-advertised and CC BY. They contain
per-objective **exam-design guidance** and per-chapter **grading rubrics**
("Evidence of mastery / What to look for"). This matches the document model
(spine documents: public repo, not on the website), so the system behaved
correctly — but it means **any student who finds the repository can read the
exam guidance and grading criteria for all 19 chapters**. Worth an explicit
owner decision about whether the assessment guide belongs in the private
repo. Related: practice pages publish full worked answers beside each
question, so published practice sets cannot double as unseen quiz material.

## D6 — educator ownership: **PASS, with the Finding-1 caveat**

Personal GitHub account (not a platform org), `fork: false`, CC-BY-4.0, plain
readable Markdown for all 19 chapters × 5 kinds, 188 asset files with
`.attrib.json` provenance sidecars, plus a committed platform-free rebuild
script (`.alembic/build/build-site.mjs`, depending only on public npm). One
inconsistency: that script emits `_site/` + `worksheets/`, while the deployed
site is `chapters/` + `practice/` + `slides/` — the DIY path produces a
differently-shaped, thinner site than what Alembic publishes.

## Link integrity: **PASS**

Every internal link 200s. All 157 figure permalinks 200 with image
content-types. All CDN and 30 Wikimedia attribution links 200. **No
localhost, no staging URLs, no link into any private repo.**

## Explicitly could not be verified without credentials

Whether the public/private **split** was correct in the first place (nothing
private leaked *out*; whether the right things went *in* is unprovable from
outside); whether `/d/{id}` enforces auth for genuinely private documents (no
private id was available to probe); the platform's own publish pipeline.
