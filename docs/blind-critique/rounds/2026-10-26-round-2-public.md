# Blind-critique round 2 (partial) — public surfaces, Block P

**Date:** 2026-10-26. **Scope:** the public, signed-out surfaces of the live
site `https://alembic.orz.how` and the student sites and public repositories it
links to. **Read-only:** no sign-in, no form that changes anything (report,
list, adapt, upload), about one request per second. **Subject:** the five
listed courses (*General Chemistry* and four demo courses) and the one shared
file listed in Discover on the day.

**Not covered** (needs the staging environment in [README.md](README.md)):
everything behind sign-in. See [Residue](#residue--what-nothing-in-this-round-could-verify).

---

## The spec amendment: Block P

The acceptance spec was frozen on 2026-08-28, before Phase 5 built Discover's
course and file pages, stable file links, the feed and the sitemap. Per the
spec's own rule it was amended **through its dated Amendment log**, not by
quiet edits (`c5281f3`): **Block P — public discovery and stable links
(signed-out visitor)**, twelve items in user language (P1 search by topic,
misspelling and prefix; P2 filters and counts; P3 paging and shareable result
addresses; P4 Discover without scripts; P5 a course's own page; P6 Adapt while
signed out; P7 shared files; P8 stable links; P9 only what was shared is
public; P10 feed and sitemap; P11 a way to raise a concern; P12 phone width and
Back). "Per-file sharing and stable links" moved out of "Out of scope". F2 may
be checked signed out, since Discover is public.

## Method

- **Two spec verifiers** (context-denied: their items, the environment sheet
  and a Playwright harness in `/tmp`, nothing under `Documents/`):
  - **Verifier 1 — Discover:** F2, F4, P1–P6, P11, P12.
  - **Verifier 2 — student sites, stable links, manners:** A1, A2, D2, D3, D5,
    D6, P7–P10, H1, H4, H5. D5 was checked from the outside: live sites, page
    sources, both branches of every public repository, the private repository's
    four access paths.
- **Free-roam critic**, given only a short public-visitor product promise.
- **Referee:** the operator reproduced findings before any fix and sent one
  fix batch.
- **Fresh re-verifier** after the fixes were deployed. It had not seen the
  round. It ran a full re-check of every FAIL/PARTIAL item that code could
  change (P1, P2, P5, P6, P7, P9, P10, P11, P12, A1, A2, H4, H5) and spot-checks
  of F4, P3, P4, P8 and H1.
- **Final pass** (this branch): the two findings the re-verifier left. The
  operator verified it with a plain HTML fetch instead of a third blind agent,
  as a proportionate step for a narrow change. This deviation from the protocol
  is recorded here.

Evidence lives outside the repository: `/tmp/bc-r2/v1`, `/tmp/bc-r2/v2`,
`/tmp/bc-r2/critic`, `/tmp/bc-r2/rv1`, with the sheet and item lists in
`/tmp/bc-r2/*.md`. `/tmp` does not survive a reboot. The one screenshot kept is
[2026-10-26-assets/h4-nojs-404.png](2026-10-26-assets/h4-nojs-404.png): the
blank no-JavaScript 404.

---

## Verdicts: first pass and re-verification

| Item | First pass | Re-verification | Evidence summary |
|---|---|---|---|
| A1 fresh arrival | PARTIAL | **PASS** | The first pass found no commit/repo/branch/merge/push, but the pitch was framed as "the way developers manage *open-source software* … without ever learning Git", with a literal "#" before the headline. The re-check found an educator pitch, "GitHub" named once and no "#" (`v2/a1-home-desktop.png` → `rv1/a1-home.png`). |
| A2 guide | PARTIAL | PARTIAL (signed-in features BLOCKED) | First pass: the Coursewerk link on `/guide/structure` was a 404; the guide promised version links that the product calls "coming"; "commits" and "repositories" appeared. Re-check: 10 readable pages, and planned features are labelled planned. It also flagged that one thing had three names: asset, element, shared file (fixed on this branch). |
| D2 site is real | PASS (SEED-B publishing BLOCKED) | not re-checked | All 5 student sites load at 1280 and 375 px; all 57 GenChem home links return 200 (`v2/genchem-linkcheck.txt`). |
| D3 only real content | PARTIAL | not re-checked | Live sites are clean. Repository history shows a first publish once pushed a template study guide ("…replace it with your own material", GenChem `380ea850`, Plate Tectonics `c2b6f723`). See the referee decisions. |
| D5 private stays private | PARTIAL | not re-checked | No Private-collection material anywhere, and the private repository is 404 on every path. **But** every public repository carries `assessment-support/*.md` with exam design, grading rules and worked answers, and practice pages name that file. See the owner decisions. |
| D6 educator owns result | PASS (private repo BLOCKED) | not re-checked | Public repositories are owned by user accounts `wangyu16` and `yuwang-cmu`, not forks, and readable without Alembic. |
| F2 Discover works | PARTIAL (signed-in part BLOCKED) | not re-checked | Signed out, every course is found by title or keyword. |
| F4 share links | PASS (friction) | **PASS** | All links load in a fresh context. There is no "Copy link" button; the citation box selects all its text on click. |
| P1 finds by topic | PARTIAL | **PASS** | First pass: "entorpy" gave 0 results, and shared-file results had no license or description. Re-check: "chemestry", "chem", "tectonis" and "crsipr" all hit; each card shows title, description, license and subject (`rv1/p1-misspell.png`). |
| P2 filters | PASS (friction) | **PASS** (friction) | Counts match results. A filter applies only after you press Search, and the accessibility filter has no options. |
| P3 paging, shareable URLs | PARTIAL (paging BLOCKED) | PARTIAL / BLOCKED | Only 5 courses and 1 file are listed, so there is nothing to page through. A copied results address reopens the same search and filters. `?page=2` silently shows page 1. |
| P4 without scripts | PASS | **PASS** | With JavaScript off, search, filters and "Clear filters" work (`v1/07-nojs-*.png`, `rv1/p4-nojs-filter.png`). |
| P5 course page | PARTIAL | **PASS** (provenance BLOCKED) | First pass: the "Topics" chips were concept-map headings ("Source and Scope", "Keywords and Tags"). Re-check: chapters link to the student site, with license, a plain-text citation and the site link. None of the five courses is adapted, so "where it came from" is untested. |
| P6 Adapt signed out | **FAIL** | **PASS** | First pass: the Sign in link was a bare `/signin`, and the sign-in page hard-coded `next=/workspace`, so the course was lost. Re-check: "You'll come back here afterwards." and `?next=/p/…?adapt=1#adapt` (`v1/09-*.png` → `rv1/p6-*.png`). |
| P7 shared files | PARTIAL | PARTIAL | First pass: no description, no preview, a raw "KETCHER" label. Re-check: a preview, a human kind label ("Chemical structure") and a "no description yet" line. The one listed file still has no description. That is owner content, the test file below. |
| P8 stable links | PASS | **PASS** | Opening the link directly, reloading it and opening it in a fresh context all give the same SVG. An unknown link gives a plain "Not found". `@1` gives "That version link isn't available". `?v=1` is ignored and serves the current file. |
| P9 only what was shared | PARTIAL | **PASS** | First pass: the shared file was in neither the sitemap nor the feed. Re-check: the listing, embedded data, feed and sitemaps (including `elements-1.xml`) agree. |
| P10 machine-readable | PASS (defect) | **PASS** | First pass: past-the-end feed and sitemap pages gave **503** "Temporarily unavailable." with `retry-after`. Re-check: feed and sitemap index present, and past-the-end pages give 404. |
| P11 raise a concern | PARTIAL | **PASS** | First pass: a bare "Reason…" box with no explanation, no cancel, and nothing with JavaScript off. Re-check: the panel says who reads a report and what may happen, and has Cancel (`rv1/p11-report-open.png`). |
| P12 phone and Back | PARTIAL | **PASS** | First pass: Discover was 385 px wide at a 375 px viewport (the Subject select was sized by its longest option), and Back between result pages left stale filter values. Re-check: 375 px on every page, and Back restores matching controls (`v1/14-*.png` → `rv1/p12-*.png`). |
| H1 cold everything | PASS | **PASS** | Major pages load in fresh sessions, also with JavaScript off. Back never traps. |
| H4 error language | PARTIAL | PARTIAL → fixed on this branch | First pass flagged: the 503 message; "Back to workspace" offered to visitors; "package"; a bare `/d` not-found page; the student-site "Framework 1.1.0 available (file uses 0.9.0)" popup. The re-check found all messages plain with JavaScript on. With JavaScript off, `/p/pkg-does-not-exist` and `/portal/element/doc-zzzz` gave a **completely blank** 404 page ([screenshot](2026-10-26-assets/h4-nojs-404.png)). |
| H5 phone | PARTIAL (editing BLOCKED) | PARTIAL (editing BLOCKED) | First pass: Discover overflowed. Re-check: reading Alembic pages and the student site at 375 px works. |

Counts: **first pass**, 23 items: 1 FAIL (P6), 14 PARTIAL, 8 PASS. **Re-verification**, 18 items: 13 PASS and 5 PARTIAL by the re-verifier's own table; its summary line said 11 PASS. No FAIL. The partials were P3, A2 and H5, blocked by too few listings or by sign-in; P7, which needs owner content; and H4, fixed on this branch.

---

## Referee decisions

**Reproduced by the referee before fixing:**

- **P6:** the course page's adapt box linked to a bare `/signin`.
  `app/signin/page.tsx` hard-coded `next=/workspace`.
- **New, found while reproducing P6:** `/auth/callback` built
  `${origin}${next}` unchecked. A crafted `next=@evil.example` was an
  **open redirect**. It is fixed by the same change, a same-site-path validator.
- **P10:** `feed/courses.jsonld?page=2` and `sitemaps/courses-2.xml` returned
  503.
- **P11:** the report control carried no explanation.
- **P1:** "entorpy" returned 0 results.
- **A1:** the home headline began with a literal "#".
- **H4, no-JavaScript 404** (final pass): reproduced against the live site and
  against a local production build. A minimal two-file Next 16.2.9 app
  produced the same empty `<html id="__next_error__">` document, so this is how
  the framework behaves.

**Accepted on independent agreement, with the cause confirmed in code by the
fix agent:**

- P12 width: verifier 1, verifier 2 and the critic each measured 385 px; the
  select was sized by its longest option.
- P12 Back: stale form values.
- P7 and P9: the shared file had no preview or description, and the sitemap
  left it out.
- P5: the concept-map headings were shown as Topics.
- A2: the broken Coursewerk link and the over-promises.
- The "organic chemistry" search matched General Chemistry: whole-phrase
  trigram looseness.

**Not reproduced:**

- **D3, template content published.** The template text ("replace it with your
  own material") no longer exists anywhere in the source, and every live site is
  clean. It is a historical artefact of an earlier publish path, now gone with
  "slots, not placeholders". Recorded, not fixed. An educator may still want to
  look at the two old commits.
- **Search relevance for "titration"** (verifier 2): General Chemistry was not
  found. This is not a defect of the matching. Chapter body text is not in the
  search index, and a title/description/keywords index is the designed scope.
  Deferred as "chapter-text search".

**Judged against the spec, not fixable in code** (owner decisions, below):
D5 assessment guides; P7's empty description on the test file; the demo
courses.

---

## Fixes applied

On `main`, deployed 2026-10-26: CI green, worker and Vercel deploys succeeded,
and migration `0035_bc_1` was applied by the owner.

- **`c5281f3`:** Block P added via the Amendment log.
- **`2eacfd2`:**
  - **P6:** sign-in keeps the course (`?next=`), and `/auth/callback` accepts
    only a same-site path (`lib/safe-next.ts`, adversarial tests). This also
    closes the open redirect.
  - **P11:** the report panel says what happens, has Cancel and Escape, and
    works as a plain POST without JavaScript.
  - **P10:** past-the-end pages give 404.
  - **P9:** a shared-file sitemap was added.
  - **P12:** Discover fits 375 px, and the search form follows Back and Forward.
- **`49d7ef2`:** **P1.** Search matches in tiers: all words, then any word,
  then a one-letter-swap typo fallback (migration `0035_bc_1`, PGlite tests).
- **`c082578`:**
  - **P7:** a real preview through the stable link, the file's own
    description, and human kind labels.
  - **P5:** chapters link to the student site, and the structural "Topics" are
    hidden.
  - US "license" everywhere.
- **`370f37a`:**
  - **A1:** home copy in educator words (old and new copy are in the
    DecisionLog for the owner's veto), plus "Browse courses" as a primary
    button.
  - **H4:** 404s offer Home and Discover; `/d` message pages get a header and
    links; the version-link message no longer says "older version".
  - **A2:** guide promises match the product, and the Coursewerk link is fixed.
  - Sign-in wording.
- **`bd16e37`, `6df6c9d`:** claims registry bindings; Status records the
  applied migrations.

On branch **`blindcritique/r2-final`**, not merged or deployed at the time of
writing:

- **H4, readable without scripts:**
  - **How it works:** the middleware checks listing on full page loads of
    `/p/{id}` and `/portal/element/{id}`. On a definite "not listed" it
    rewrites to the server-rendered site 404, so the heading, message, Home and
    Discover links are in the HTML, with status 404.
  - **Tests:** `lib/public-not-found.test.ts`, `middleware.test.ts`, and
    `app/not-found.html.test.ts`, which fetches real HTML. That last test
    passed against a local production build for an unknown course, an unknown
    shared file and the generic 404.
  - **After deploy, run:**
    `NOT_FOUND_HTML_BASE_URL=https://alembic.orz.how pnpm --filter @alembic/web exec vitest run src/app/not-found.html.test.ts`
- **One name, "shared file":**
  - **Where:** Discover's tab is "Shared files". Counts, the course page, the
    file page, adapt messages, the workspace paste-a-link control and the
    guide's visitor-facing sentences all use "shared file".
  - **What stays:** "Assets" remains the name of the collection; URLs and code
    identifiers keep "element". See the DecisionLog.
  - **Also corrected:** Discover's empty state named a non-existent "Share
    this" control; it now names the real "Discoverable" tick.

## Deferred free-roam findings (recorded, not fixed)

**Student course site.** The site build is being replaced (Track C / B.4,
carriers 1.x), so these wait for it:

- **Student-site navigation:** chapter pages have no link to the course home,
  the next or previous chapter, or that chapter's slides and practice.
- **Practice option layout:** multiple-choice options run together on one line.
- **Slides controls on a phone:** no visible next/previous control or hint
  that the deck continues.
- **The old "Framework 0.9" update popup:** "Framework 1.1.0 available (file
  uses 0.9.0)" with Update/Dismiss, shown to anyone who opens the in-page
  editor on an older published file.

**Deliberate design, not a defect:**

- **The edit pencil on student pages** is the self-editing promise of orz
  files (anyone can edit and download their own copy;
  `docs/specs/self-contained-editing.md`). Whether a *published* course page
  should show it is a product question for the carrier rebuild, not a bug.

**Product features not yet built:**

- **Per-figure permalinks inside chapters:** figures carry relative paths, with
  no anchor and no "copy link" or "cite this figure".
- **Mixed-license warning:** the course badge says CC BY 4.0 while some figures
  are CC BY-SA, disclosed only in the asset table at the bottom of a chapter.
- **Quality signals and author profiles:** no reviews, adoption counts,
  institution or profile.
- **Chapter-text search:** "titration" does not find General Chemistry, because
  chapter bodies are not indexed.

**Discover polish:**

- **Filters apply only on Search:** choosing a value does nothing until Search
  or Enter, and nothing hints at that.
- **Empty accessibility filter:** "Any accessibility" has no other options
  until courses carry an accessibility check (owner decision 2, 2026-10-24).
- **Header sign-in links don't return to the current page:** the header's
  "Sign in" is a plain `/signin`. P6's adapt link does carry the course.
- **`?page=2` silently shows page 1** when there is no second page. It should
  say so, or answer like the harvest routes do.

## Owner decisions pending

1. **The demo courses.** Four of the five listed courses describe themselves
   as AI-generated demos "not a course package intended for direct use in real
   teaching". Each ends with the garbled sentence "AI generation resulted
   residual flaws are reserved intentionally." Options:
   - unlist them;
   - keep them, labelled "Demo" and left out of default results;
   - fix only the sentence.

   Recommended: the "Demo" label with default exclusion, plus fixing the
   sentence.
2. **The test shared file**, "test sharing" from the course "test3". It is the
   only entry under Shared files, so Discover's file listing looks unfinished,
   and it is why P7 stays PARTIAL. Recommended: unshare it (untick
   Discoverable).
3. **Assessment guides in public repositories, against spec D5.**
   `assessment-support/*.md` carries exam design guidance, grading rules and
   worked answers, and D5 says assessment answers must never be public. The
   choices are to move the guides to the private repository (a content-model
   change for Track C) or to rule them public by design and amend the spec.
   This was already raised in round 1 (Finding 3). Recommended: private.
4. **`alembic.json` names the private repository** in the public repository
   (`privateRepo.owner/name`). This was round 1's Finding 2. Recommended: omit
   `privateRepo` from the public copy.
5. **Commits by `alembic-dev-yu[bot]`.** Educators' repositories show a
   "dev"-named GitHub App as author. Rename it, or switch to a production app.

## Process notes

- **Request budgets.** Both first-pass verifiers exceeded their 300-request
  budget. Their own page actions stayed at about one per second (roughly 200
  and 170), but sub-resources and link prefetching pushed browser requests to
  about 1,600 each. Verifier 1 says about 640 of those came from a single
  19-search script. The critic, given a tighter instruction, used 263, and the
  re-verifier about 273. **Later rounds block prefetch, fonts and images by
  default** and count sub-resources in the budget.
- **Stray files.** Verifier 2's first command ran in the wrong directory and
  wrote two scratch scripts (`lib.mjs`, `s1.mjs`) into this repository's
  `docs/blind-critique/`. It deleted them at once. The referee checked
  `git status`: clean, and nothing tracked was touched. Later rounds start
  every agent with an absolute `cd` into its own `/tmp` folder.
- **Cache lag after deploy.** The first live check of "entorpy" after 0035 was
  applied still returned 0. Discover's results are cached for up to 120 s; the
  retries found both entropy courses.
- **Final-pass verification** was an operator HTML fetch, not a third blind
  agent; see Method.

## Residue — what nothing in this round could verify

- **Everything behind sign-in:**
  - Block A: A3–A6 (create, trial limits, rename/archive/delete, dead buttons).
  - Block B: all items, chapters and everyday authoring.
  - Block C: all items, files in and out (upload, zip, replace, round-trip).
  - Block D: D1 (the two publish steps) and D4 (republishing reflects an edit).
  - Block E: all items, versions, restore, snapshots and outside edits.
  - Block F: F1 (listing requires an open license and confirmation) and F3
    (adapting creates an attributed copy).
  - Block G: all items, the AI assistant.
  - Block H: H2 (double-click safety) and H3 (two tabs).
  - Also the signed-in halves of F2, H5 (edit and save on a phone) and P6
    (landing on the adapt box after a real GitHub sign-in).

  These all need the staging environment and test accounts described in
  [README.md](README.md).
- **Real GitHub Pages propagation:** how long a publish takes to show on the
  student site. The sites were judged as they stood.
- **Long-horizon versions:** history over weeks and terms, snapshot
  citations that must stay valid, links to particular earlier versions
  (planned, not built).
- **P3 paging** at real scale: only 5 courses and 1 file are listed.
- **P5 "where it came from"**: no listed course is adapted.
- **Whether the public/private split was right in the first place**: nothing
  private leaked *out*, but whether the right things went *in* cannot be
  proven from outside. This is unchanged from round 1.
