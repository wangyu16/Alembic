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
