# Alembic Acceptance Spec (frozen 2026-08-28)

> Written BEFORE the storage/write-path implementation it will verify.
> Amendments after this date must be visible and recorded (dated note at the
> bottom), never quiet edits. This spec outranks implementation intent: a
> FAIL is judged against this document, not against what the code was
> "supposed" to do.

## What this product is

Alembic is a web platform where **educators** (not developers) build,
publish, and share course-resource packages — study guides, slides, practice
questions, images — without touching Git or GitHub concepts. A course is a
set of chapters; each chapter has five documents (concept map, study guide,
slides, assessment guide, practice questions) plus shared file collections
(Assets, Current term, Private). Content is chemistry/STEM-flavored text
with math and chemical notation, typically a handful of chapters of a few
pages each. The platform promises: familiar actions (save, preview, publish,
snapshot, restore), permanent versions of every change, materials stored in
the educator's own GitHub account (two repositories: one public, one
private), a public student website, and strict separation of private
instructor material (answer keys, notes) from anything public.

## Launching for verification

The operator provides an **Environment sheet** with: the app URL (staging or
local), one signed-in test-educator session per verifier (GitHub connection
already completed), and the seeded states below. Drive the app with
Playwright (desktop ~1280px and phone ~375px viewports). You mutate real
state in YOUR OWN test account's packages only; never touch a package whose
name doesn't carry your verifier tag.

Seeded states (operator-created through the app itself; IDs on the sheet):
- SEED-A: a **trial** course (never published) with 2 chapters of real text.
- SEED-B: a **published** course (GitHub-backed) with 3 chapters, images in
  Assets, a live student website, and at least 2 saved versions of chapter 1.
- SEED-C: a published course that is **empty** (just created + published).
- SEED-D: a valid course package as a **.zip** (~10–20 MB, includes images)
  and a second, deliberately broken zip (missing required file).
- SEED-E: a second educator account owning a **publicly listed** course
  (open license), for discovery/adaptation items.
- SEED-F: single files for upload tests: a plain `.md`, a `.md.html`
  downloaded from a SEED-B document, an image, a PDF, a >100 MB file.

If a listed state is missing or unreachable, report the affected items as
BLOCKED — never silently skip.

## Verdicts

PASS / PARTIAL / FAIL / BLOCKED per item, each with evidence (screenshot,
URL, exact visible text). Friction is reportable even on PASS. Honesty over
optimism — a well-evidenced FAIL is worth more than an optimistic PASS. If
you catch yourself wanting source code to explain a behavior, that behavior
is simply what the product does — judge it.

---

## Block A — First contact & course lifecycle

- **A1 — Fresh arrival explains itself.** In a fresh session, the homepage
  says what Alembic is for in educator language; no Git/developer jargon
  (commit, repo, branch, merge, push) anywhere on it.
- **A2 — Guide exists.** A guide/orientation page is reachable from the
  header and readable start to finish; every feature it names is findable
  in the app.
- **A3 — Create a course.** From the workspace you can create a new course
  (title, license choice) in under a minute; it opens ready to edit with
  clear guidance on what to do first — and it does NOT force GitHub
  publishing on you at creation.
- **A4 — Trial is honest about limits.** A never-published course states
  plainly that images/PDFs need publishing first; trying to upload an image
  (SEED-F) is refused with that plain explanation, not an error code.
- **A5 — Rename / archive / delete.** From the course list: rename works
  everywhere the title appears; archived published courses leave the public
  listing but keep their data and can be restored; deleting a trial course
  asks for confirmation and permanently removes it from the list.
- **A6 — No dead buttons.** Every visible control on the workspace landing
  and course list does something or explains why it can't.

## Block B — Chapters & everyday authoring

- **B1 — Add a chapter.** Adding a chapter (SEED-A and SEED-B) makes it
  appear immediately in navigation, and it is still there after a full page
  reload and a fresh session.
- **B2 — Rename / reorder / delete chapters.** Each works from the chapter
  management dialog, survives reload, and deleting asks for confirmation;
  deleting the ONLY chapter is refused with a plain explanation.
- **B3 — Five documents per chapter.** Each chapter offers its five
  documents (concept map, study guide, slides, assessment guide, practice).
  A document you never touched shows a helpful empty state — NOT
  boilerplate placeholder prose presented as if it were your content.
- **B4 — Edit and save.** Edit chapter text in each editable document type,
  save, reload cold: the exact edit is there. Saving shows a visible
  in-progress state and a clear success.
- **B5 — Save never lies (published).** On SEED-B, a save either fully
  succeeds or clearly tells you it failed and lets you retry — it never
  silently keeps a version only "sort of" saved. (If you can simulate
  offline mid-save: the failure message is plain language, your text is not
  lost from the editor, retry works after reconnecting.)
- **B6 — Rapid additions all survive.** Add three chapters back-to-back as
  fast as the UI allows; all three exist after reload.
- **B7 — Chapters survive unrelated edits.** Add a chapter, then: change
  the course description, change the theme, edit term links, run any
  checks offered. The chapter (and every other chapter) is still present
  after each action and after reload. **This is a known past failure —
  test it hard.**
- **B8 — No silent divergence.** After any save on SEED-B, the version
  history for that document shows the new version; nothing anywhere claims
  "saved" while history disagrees.
- **B9 — Unit wording.** Changing what the course calls its units
  (chapter/module/week…) is reflected across the workspace immediately.

## Block C — Files in and out

- **C1 — Upload into collections.** A text file uploads into Assets on both
  SEED-A and SEED-B; an image uploads on SEED-B (published) and lands
  viewable; the >100 MB file is refused with a plain size explanation.
- **C2 — Download.** Any document/file downloads; the downloaded study
  guide opens locally in a browser as a readable, self-contained page.
- **C3 — Round-trip.** Download a chapter document from SEED-B, change one
  sentence locally, use Replace to upload it back (try BOTH the plain
  text download and the self-contained `.md.html` from SEED-F): the change
  appears in the app, the document stays clean and readable — never raw
  HTML/code shown as your content — and its share link is unchanged.
- **C4 — Replace works on untouched documents.** On a chapter document you
  never opened before, Replace/upload still works (no "nothing here to
  replace" dead end).
- **C5 — Any filename lands right.** Uploading a correctly-formatted file
  whose NAME doesn't match anything (e.g. `my-energy-slides.md`) into a
  chapter's slides is either placed correctly (with a note saying where it
  went) or refused with a plain explanation of what to do — it never
  silently disappears or lands somewhere unexpected.
- **C6 — Wrong file, honest answer.** Uploading a nonsense file (a PDF
  into a text document slot, a random binary) is refused with a
  plain-language reason; nothing is corrupted afterwards.
- **C7 — Whole-course zip upload.** On SEED-C (published, empty), the
  ~10–20 MB SEED-D zip uploads successfully — images included — and the
  chapters/documents from the zip all appear. The size being over a few MB
  must NOT be a failure reason.
- **C8 — Zip failure is explained and recoverable.** The broken SEED-D zip
  is refused with specific, plain reasons (what's wrong, what to fix). A
  refused or interrupted upload does NOT permanently brick the course:
  fixing the zip and retrying works.

## Block D — Publishing & the student site

- **D1 — Two clear steps.** Publishing offers two understandable steps
  (save your course to GitHub; publish the website); each explains what it
  does before doing it, and publishing requires your explicit confirmation.
- **D2 — The site is real.** After publishing SEED-B changes, the public
  site URL loads for a signed-out visitor on desktop and phone; chapters
  and documents you created are all reachable within 2 clicks of the
  course home.
- **D3 — Only real content publishes.** Documents you never filled in do
  NOT appear on the student site as empty/boilerplate pages.
- **D4 — Update page.** After editing and saving, running the publish/
  update step again makes the public site reflect the edit (allow a short
  build wait).
- **D5 — Private stays private.** Nothing from the Private collection or
  assessment answers is reachable anywhere on the public site or its
  underlying public GitHub repository — check page source and the repo's
  file listing. **This is the platform's hardest promise.**
- **D6 — Educator owns the result.** The published site and both
  repositories live under the educator's own GitHub account, readable
  there without Alembic.

## Block E — Versions: the safety net

- **E1 — Every save is a version.** After several saves on one chapter,
  its history lists them with dates; nothing requires writing "commit
  messages".
- **E2 — Restore goes forward.** Restoring an older version brings that
  content back AND appears in history as a new step — the newer versions
  remain listed (nothing is erased).
- **E3 — Snapshot.** Creating a named snapshot ("Fall 2026") succeeds and
  is listed; citation text for the course is copyable.
- **E4 — Outside edits are first-class.** Edit a file of SEED-B directly
  on GitHub (the operator sheet includes how), then return to the
  workspace: the app notices, explains in plain language, and offers to
  bring the change in; accepting shows the edit in the app.
- **E5 — No Git vocabulary.** Across ALL of Blocks B–E, the UI never
  requires understanding commit/branch/merge/rebase/PR; flag every
  occurrence you see.

## Block F — Sharing, discovery, adaptation

- **F1 — Listing is deliberate.** A course appears in public Discover only
  after an explicit "list publicly" action that requires an open license
  and a copyright confirmation; an all-rights-reserved course can publish
  its own site but CANNOT be listed, with the difference explained.
- **F2 — Discover works.** SEED-E's course is findable in Discover by
  title/keyword by another signed-in educator.
- **F3 — Adapt.** Adapting SEED-E's course creates your own full copy,
  clearly attributed to the original; your edits don't touch the original.
- **F4 — Share links.** Copyable public link(s) exist for a published
  course; they load for a signed-out visitor.

## Block G — AI assistant (only if enabled on the test account)

- **G1 — Gated and explained.** Without approval the AI features say how to
  request access; with approval they appear.
- **G2 — Propose → review → apply.** An AI aid (e.g. spelling/grammar) on a
  document shows a proposed change for review; nothing changes until you
  accept; reject leaves the document untouched.
- **G3 — Selection aid.** Improving a highlighted passage changes only that
  passage after acceptance.
- **G4 — Refusals are human.** Rate/budget refusals are plain sentences,
  not codes; the assistant declines off-topic requests (it is a
  course-material aid, not a general chatbot).

## Block H — Resilience & manners (free-roam-adjacent)

- **H1 — Cold everything.** Every major page loads correctly in a fresh
  session (no warmed-up state required); the Back button never traps you
  or logs you out.
- **H2 — Double-click safety.** Double-clicking Save/Create/Upload buttons
  never creates duplicates or errors.
- **H3 — Two tabs.** The same course open in two tabs: edits from tab A
  are not silently destroyed by tab B; whatever the behavior, data loss
  must not be silent.
- **H4 — Error language.** Collect every error message you encounter
  anywhere: each must say what happened and what to do, in educator
  language. Flag any raw code, stack trace, or jargon.
- **H5 — Phone viewport.** Core flows (read, edit a little, save, view
  site) are usable at ~375px without horizontal scrolling.

## Out of scope for this review (planned, not yet promised)

Per-file element sharing/permalinks on Discover, a unified review Inbox,
the in-workspace AI course-builder (hosted coursewerk), LMS export polish,
print/paged output. Complaints here are welcome as product feedback but are
not FAILs.

## Amendment log

*(empty at freeze)*
