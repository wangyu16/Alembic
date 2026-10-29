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
