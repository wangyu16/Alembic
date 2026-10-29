# The real-course loop (workspace v3 on testing)

Closed-loop rounds run against a real course: the owner's General
Chemistry (19 chapters × 5 parts, 188 assets, 0.x slide decks, 157 figures
named by 0.x permalinks), moved with the A14 helper into a v3 course on the
testing site (`pkg-general-chemistry-testing-copy-ndc336m7`). Claims:
[docs/claims/v3-real-course.toml](../../claims/v3-real-course.toml) (RC.n).
Blind acceptance spec: [docs/blind-critique/v3-workspace-spec.md](../../blind-critique/v3-workspace-spec.md).

## Round 1 (2026-10-29)

**Live findings (me, using the course):**
- **RC.1:** all 19 decks kept their 0.x `<!-- deck -->` block. Publish passed, then every website build failed. The fix: the helper runs orz-slides' `upgradeText`. Family drift D-125: the carrier's lints don't flag the block.
- **RC.2:** Publish read about 450 files one at a time (1 m 42 s, then 2 m 37 s). Reads now run 8 at a time; a 19-chapter Publish then took 29 s live.
- **RC.3:** website failures weren't explained on the page. Each problem is now listed.
- **RC.4:** ~100 document links were prefetched, each rendering a document page server-side. That's off now, and also for Publish and course links.
- **Course tokens:** reused across requests instead of minted per page.
- **Session end:** `/signin` now returns you to the page you were on.

**Independent audit (rounds against the claims and the design):**
- **F1 (HIGH) → RC.6:** the copy checks were quadratic and ran on image bytes, stalling the worker. Fingerprint sets are now built once, words and hashes computed once per file, and media files contribute only their printable text runs. The real-size check went from more than 15 minutes to 10 s.
- **F2 (HIGH) → RC.7:** Door C never finished a push of more than 300 files. It now compares tree to tree and raises one grouped item.
- **F3 → RC.8:** the Publish page made ~40 GitHub calls per render. It now uses one tree listing, with versions cached by blob id.
- **F4 → RC.9:** relative images were broken in the editor. Members-only asset route plus a path→address map for the editor.
- **F5 → RC.10:** the move helper kept 0.x permalinks. `--resolve-permalinks` rewrites them (157 of 157 matched for GenChem); the testing copy was relinked through the sync queue.
- **F6:** prefetch scope widened, as above.
- **F7:** `mapLimit` stops starting work after a failure.
- **F10:**
  - an unreadable manifest gets a message instead of a 500;
  - the document link is encoded;
  - the size limits are named.

**Dismissed, with reasons:**
- **F8 (no Publish input size cap):** Publish must read every file to classify it by content (G3 r2 M5), and memory is bounded by the course's size. A course size limit is an owner decision, raised separately.
- **F9 (a revoked repo or new App permissions take up to ~55 minutes to apply):** the cached token still refreshes on a 401, and permission changes are rare and done by the operator.
- **RC.5 timeouts:**
  - The re-crawl found 5 of 95 practice pages timing out at "network idle".
  - Each opens in about 3.5 s alone (3 tries), and the failures don't line up with any Publish or website run.
  - Recorded as not reproduced: 90/95 clean, median 5.8 s.

**Blind critique:** verifiers for blocks A, B and C of the spec ran in parallel with this round; their findings start round 2.

## Round 2 (2026-10-29)

**Blind verifiers, round 1 of the spec (blocks A, B, C):**
- C1–C3, B1–B3 and B6 passed, with friction.
- Failed: A3 (saving), A8 (Download) and A9 (an outage plus developer words).
- Partial: A1, A4 and A6. Blocked: B7.

**Findings and fixes:**
- **RC.11 (HIGH):** the outage the verifiers hit was the owner's GitHub budget (5,000 requests an hour) running out at 04:03 UTC. Every course page returned 500 for about 10 minutes, and a Publish failed with no reason. The cause was ~1,000 requests per GenChem Publish plus its website. Both now read whole trees from one archive request (a tar reader with a real-substrate test). Live: a Publish plus its website used 8 requests.
- **RC.12:** a rate limit now shows a calm "busy until HH:MM" page, and a Publish stopped by one says so.
- **RC.13 (A3):**
  - **Was:** "Saved" meant this browser only, and leaving within about 2 minutes lost the sync (a server action from an unmounting component).
  - **Now:** the sync is a keepalive request to a route, and the status says plainly where the text is. The editor says Saved only once the course has it. Idle sync is 30 s (design §7.1 said 2 minutes; owner to confirm), and closing with unsent text asks first.
- **A8:** Download was wired into every document.
- **RC.14 (A1):** the course page is organised by chapter.
- **RC.15 (B1, B4, B5):** Publish page clarity. A pending status change shows as saving, plan approval is a single click, and chapters are named by title.
- **RC.16 (B3):** the website opens on a course front page.
- **Other fixes:**
  - **readability:** the presence strip, notices and the Publish button are readable now;
  - **document page:** shows the document title, and its top bar is visible on load;
  - **wording:** "repository" is gone from the workspace text;
  - **try mode:** Save downloads a copy.

**Owner's call (surfaced, not decided):**
- the idle sync interval (30 s vs the design's 2 min);
- whether assessment guides stay public (the v3 contract publishes them);
- a workshop contact for try mode's "Join a workshop".

**Not Alembic's (family):** A6, the slides card following the preview's scroll, is orz-slides behaviour.

## Round 3 (2026-10-29)

**Independent audit of rounds 1–2:** 2 HIGH, 7 MEDIUM, 3 LOW. All are fixed or recorded (Alembic `131082b`).

- **RC.17 (HIGH):**
  - **Was:** unsent text on a device was silently dropped when the document was reopened after the course moved on. The same root (the editor's base never moved forward after its own sync) caused false "someone else changed this" conflicts in long typing sessions.
  - **Now:**
    - the device record knows whether the course has its text;
    - unsent text wins on reopening and is sent on its own base;
    - our own echo moves the base forward;
    - keepalive is measured in bytes;
    - an ended session says "sign in again".
- **RC.18 (HIGH):** the archive was unbounded against the worker's 512 MB. `treeReader` lists the tree once and uses one archive up to 80 MB, or blob-by-blob reads above that. Every archived file is checked against its blob id, and the read retries. Publish, the website build and Door C use it.
- **RC.19 (budget):**
  - images are addressed by blob id and cacheable for a day;
  - landed syncs aren't read back;
  - the Publish page caches by commit;
  - live: a Publish plus its website used about 13 requests.
- **RC.20:** members see the queue's status, not each other's texts (migration 0060).
- **Door C:** an undo never turns a failed read into a delete.
- **RC.12 gaps:** actions, reads and the course page now handle rate limits. Pages don't sleep through GitHub's wait, and times are given in the course's time zone.
- **Publish page:** while a status change is pending, no other is offered; a refused one is reported.

**Open, by choice:**
- binary undo by Door C (it restores text only);
- a request ledger per installation;
- a real-browser test of the editor's sync paths. That is covered for now by the blind re-verifier and live checks.

## Round 4 (2026-10-29): the free-roam critic and re-verifier 2

**Re-verifier 2:** 9 of 10 items passed (A1, A3, A4, A6, A9, B1, B4, B5); B7 blocked; A8 partial. Spot-checks (a), (b) and (d) passed; (c) failed; (e) wasn't verified.

**Fixed (Alembic `f535030`):**
- **RC.21:**
  - **Was:** "Approve it as it is now" approved nothing. Next replaces a formAction button's name, so its value never arrived; this was reproduced live. The bug left Gases stuck out of every Publish.
  - **Now:** the value is a bound argument, and a scan pins the class. Live: approved.
- **RC.22:** a single, honest Save; "Opening…" while things load; Present for slides.
- **RC.23:** downloads embed the course's figures (A8 had 9 of 9 broken).
- **RC.24:**
  - Publish can't publish a chapter's old status (re-verifier B4 trap);
  - each chapter shows "edited since the last Publish";
  - times are in the course's time zone;
  - the course page says what the person may do.
- **Home page:** links to try mode when v3 is on, and the try buttons are readable.

**Not reproduced (with evidence):** critic #2's "← Course loses the edit". On the current build, a leave 2 s after typing sent the text (sync request 200, queue row done). The critic's session overlapped two deploys.

**Dismissed or deferred, with reasons:**
- **Raw markup in the editor (critic #4):** the editors are the family's text-plus-preview carriers by design (FD-07, the self-contained editing decision). A visual editor is a product decision for the owner, not a defect here.
- **The public site's "Edit and more" pencil (critic #11):** self-editing pages are the family's published format (FD-07/FD-08). Whether student sites hide it is a carrier or orz-site option to request (family).
- **The slides card follows the cursor, not the preview's scroll (A6):** orz-slides behaviour, for the family.
- **A plan awaiting approval doesn't appear in Needs you (critic #1):** a new Needs-you kind, deferred to the A10 approvals work.
- **No per-document history or "changed by" (critic #12):** a feature, deferred.
- **The deputy sees "Admin":** that's the test setup; this test user was made an operator for the workshop-code check.
- **Two create-course forms on the workspace:** the old 0.x form is still on the testing build; v3 replaces it.

**Dismissed:** the 404 in the website's console is the browser's own `/favicon.ico` request at the host root (`<owner>.github.io`), which a project site can't serve.

**Open (owner's call):** multiple-choice options run together in practice pages. The 0.x content writes options on consecutive lines, and 1.x Markdown joins consecutive lines into one paragraph. Options:
- the move helper turns `A. …` option runs into separate lines (hard breaks or a list);
- the content is fixed by hand.
- the owner's calls carried forward: idle interval, public assessment guides, workshop contact.

## Round 5 (2026-10-29): audit of rounds 3–4

The audit found 2 HIGH, 4 MEDIUM and 5 LOW. Fixed in Alembic `79d8c27` and `d6b09e4`.

- **HIGH-1:**
  - **Was:** reopening with unsent text could revert others' changes. The resumed text was queued with its own base, but the editor kept the course's current base, so the next keystroke resent it on the wrong base.
  - **Now:** the base follows the resumed text and it's sent at once. Records from before the `synced` flag resume only if the course hasn't moved (the old rule).
- **HIGH-2 (RC.25):**
  - **Was:** Present ran course content with Alembic's origin (stored XSS across members).
  - **First fix:** a sandboxed frame. Live, it inherited the page's enforced CSP and showed 0 slides.
  - **Now:** the deck goes by same-site form post to a members-only `/present` route, served under `sandbox allow-scripts`. Live: 29 slides, origin `null`.
- **MEDIUM:**
  - Save no longer reports "offline" while a sync is under way, and leaving mid-sync no longer drops text (`syncNow` waits, then sends);
  - `rebase` updates the draft in place;
  - the tar overhead is counted in the unpack limit;
  - a failed archive falls back to blob reads.
- **LOW:**
  - migration 0061 (`approve_part` null role; `request_publish` refused while a status change is pending);
  - edited-since-Publish uses the publisher's chapter rule;
  - figures in code blocks are left alone.

**Deferred, with reasons:**
- **MEDIUM-6:** a course over 80 MB is read blob by blob and spends GitHub budget again. A streaming archive parse fixes it; GenChem is far below the limit.
- **L11:** signed image addresses outlive a member's removal by up to 48 h. Accepted: the addresses are only ever handed to members, and shortening them breaks caching.
- **MEDIUM-3 remainder:** two syncs before the first echo can still record a "both changed" item. No text is lost (the typist's text is on top). Fixing it means waiting for the echo before sending again.

## Round 6 (2026-10-29): audit of round 5 and re-verifier 3

Fixed in Alembic `0fa5129`; deployed to testing and checked live.

- **H-1 (RC.17):**
  - **Was:** a device text that the course already held at an older version could be resumed and sent again, reverting later changes.
  - **Now:** before resuming, the editor asks the course whether it holds that text at any version (by hash). If it does, the device copy is dropped.
- **M-1:** no edit is queued while a resume is being decided.
- **M-2 (RC.25):**
  - Present posts the deck as multipart, with CDN delivery and figures linked by their absolute signed addresses, so figure-heavy decks stay under the 40 MB cap.
  - Live: 29 slides, origin `null`, 9 of 9 figures load.
- **Re-verifier 3, A8 (RC.23):**
  - **Was:** downloaded SVG figures showed as base64 text. The renderer refuses `data:` addresses in Markdown image syntax; this was confirmed with the real renderer.
  - **Now:** embedded figures are written as `<img>` tags. Live (Gases study guide): 9 of 9 figures shown in the downloaded file, with no base64 text.
- **Publish page:**
  - times are shown in the reader's own time zone (live under a Tokyo browser: GMT+9);
  - the "(on GitHub)" spacing is fixed;
  - the heading "The most recent Publish" marks it as history ("stayed as it was then").
- **Multiple-choice options (owner's call, made easy):**
  - The move helper has an opt-in `--split-options` that keeps `A. …` / `(A) …` option runs on separate lines with hard breaks (checked with the real renderer: `<br>` between options, inline math intact).
  - GenChem dry run: 53 runs in 19 files.
  - Off by default and not applied to the testing copy.

## Round 7 (2026-10-29): audit of round 6

**No HIGH.** H-1 was only partly fixed, and that hole is MEDIUM-1 below. Round 6's other fixes were verified, including signed addresses, the Present sandbox, `<img>` escaping, the Publish guards and the archive bounds.

- **MEDIUM-1 (RC.17):**
  - **Was:** resume asked "does the course hold this text at any version?". A revert to older text (delete what you just added, then the tab dies) matched, so it was dropped silently.
  - **Now:** the device record notes the sync id that carried exactly its text, and resume asks whether *that* sync reached the course.
  - The note is written alongside the request, never before it, so a closing page doesn't wait on storage (RC.13).
  - A text with no recorded sync was never sent, so it is resent.
- **MEDIUM-2 (RC.17):** others' versions that land before the editor opens are kept and applied once it opens. Versions recorded after the page was made but before the editor listened are caught up once on subscribing.
- **LOW-1:** a deck too large to post says so in plain words, instead of showing the host's raw error page.
- **LOW-2:** device records are read and written in one transaction.
- **LOW-4:** inline code is left alone in downloads and Present.
- **Unconfirmed → fixed (RC.11):** a rate-limited archive is reported as busy, not worked around with one request per file.

**Open, with reasons:**
- **LOW-3:** if the "did it arrive?" check itself fails, the text is resent. The server merges it on its old base. It now costs one database read, so failures are rare.
- **Catch-up limit:** the catch-up misses a revert to a version recorded earlier (`doc_versions` keeps one row per text).
- **Asset route:** it has no server cache. Signed addresses are handed only to members.
- **Stuck `system:mode` rows:** a row stuck in `retry` would block Publish. Retries are bounded by the worker's attempt cap.
