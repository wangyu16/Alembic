# Scale & UX audit — findings and disposition

**Date:** 2026-08-28. Two read-only audits run after a real 19-chapter /
**333-file / 21.8 MB** course exposed a class of bug invisible on test data.
Cost model: `listFiles` returns every file's CONTENT and binaries are stored
base64, so **one whole-package read ≈ 29–30 MB**; `listPaths` ≈ 30 KB;
`readFile` = one row.

## Fixed in this pass

| # | Finding | Why it mattered |
|---|---|---|
| 1 | `/api/asset/…` read the whole package **per image request**, `no-store` | The editor preview rewrites every figure to this route and re-renders on a debounce **while typing** — a chapter with 8 figures moved ~240 MB per refresh. Now one row, plus an ETag so unchanged figures cost a 304. |
| 2 | `listByPackage` (registry) had **no pagination** | Tombstones are kept forever, so past 1000 rows the "have paths changed?" fast path could never match — silently reinstating the full 30 MB + ~1000-round-trip rebuild on every page load. A latent regression **inside the fix that removed it**. |
| 3 | `loadCollectionFileAction` read the package to open one file | Every click that opens a file in Assets / Private / Current. |
| 4 | `loadCourseConceptMap` read the package for one small file | Every Course-view render. Fallback semantics preserved exactly. |
| 5 | `listTerms` read content to **count** files per term | Every Current-collection render. |
| 6 | `listAssets`, `deleteChapter`, collection delete / replace / create read content for **existence checks** | Paths-only or single-row now. |
| 7 | **Publish could silently drop chapters and report success** | A per-chapter `catch {}` swallowed build failures; they were never added to the reported `skipped[]`. An educator could ship a course missing six chapters believing it worked. Now reported by name in the existing warning channel. |
| 8 | Publish failure could show **nothing at all** | The trigger had no `try/catch`, so a timeout rejected inside the transition: the button flipped back to idle with no message. |
| 9 | Raw GitHub API text appended to educator copy (`committer.ts`) | Produced e.g. *"…try again in a moment. (GitHub POST /repos/…/git/trees failed (HTTP 422): {"message":"GitRPC::BadObjectState"})"* — across **12 call sites**. Now logged server-side; educators get plain language. |
| 10 | `ManageDialog` unbounded height | Same unreachable-action bug as the upload panel, on the dialog a 19-chapter course needs most: "Add a chapter" and "Done" fell off-screen with nothing to scroll. Bounded + sticky footer. |
| 11 | Worker `fetch` had **no timeout** | One hung call consumed the whole publish budget. Now `AbortSignal.timeout(45s)`. |

## Queued — highest value first

1. **Registry rebuild on every WRITE** (`syncPackageRegistry`, 13 call sites):
   a whole read **plus 2–3 DB round-trips per file** → ~700–1000 serialized
   round-trips after every save. Fix: register only the files the write
   touched (the call sites know their change set); batch the genuine full
   rebuild (populate/reconcile) via one indexed read + bulk upsert.
   *Highest-risk item in the audit:* `registerFile`'s identity ladder
   (embedded uid → content hash → location) is order-sensitive and resolves
   duplicate-content identity against rows staged earlier in the same run.
2. **Bound the publish loop.** Up to 57 sequential worker generations; bounded
   concurrency (4–6) or the upload route's chunk-and-resume pattern.
3. **Per-row pending state** in the collection views — one shared
   `useTransition` greys out all 300 rows for any single action.
4. **LMS export N+1** — `loadAnswerKey` per item, each a whole read (40 items
   ≈ 1.2 GB).
5. **`reconcilePublicRepo`** — fetches changed study-guide files twice and
   writes one file per call.
6. **`rewriteMarkdownRefs`** — one registry round-trip per reference during
   populate; snapshot the registry once instead.
7. **Error-copy sweep** — `publishErrorMessage` reads as an operator runbook;
   "GitHub" contradicts the UI's own "Save online"; a commit SHA and
   `CITATION.cff` are shown as UI; `WORKER_URL` and HTTP statuses leak;
   ~25 dead-end "Please try again" strings.
8. **Mobile**: `.btn-xs` is used 17× but **never defined**, so file-row
   buttons render full-size on a phone; rows don't wrap.
9. **`site-preview`** repeats the publish path's reads with no `maxDuration`.
10. **Current collection** renders all 19 chapters fully expanded.

## Confirmed correct — do NOT "optimize"

`release-gates` check 6 (scans every public text file's body for private
references — narrowing it would silently disable the leak gate); the publish
commit (stages every file); `forkPackage`; populate's content-equality diff
(what makes a resumed upload idempotent); `rebuildPackageRegistry`'s read
(hashes and embedded uids come from bytes — the round-trips are the bug).
