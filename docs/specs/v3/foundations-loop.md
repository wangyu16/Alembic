# The foundations loop (workspace v3, step 1: the course contract)

The closed-loop record for step 1 of the foundations work: the package
contract v3, draft 5 (`package-contract-v3.md` §0, §11–§16). Its claims are
K1.10–K1.19 in [docs/claims/v3-foundations.toml](../../claims/v3-foundations.toml),
and the family decisions behind it are FD-09 (Coursewerk owns course content)
and FD-10 (Alembic is a general publishing platform; Coursewerk is its first
content profile).

## Design gate (G0), 2026-10-29

- **Round 2** reviewed draft 3. It passed with fixes: 3 HIGH, 8 MEDIUM and
  6 LOW, all applied in draft 4 (§15).
- **Round 3** was a fresh reviewer on draft 4. It passed with fixes: holes
  in the companion specs, and one new HIGH-MEDIUM (mechanics fields via a
  push). All were applied in draft 5 (§16).

## Built (2026-10-29, Alembic `b9a7afe` to `52dd1e6`, deployed to testing)

| Piece | What | Live check |
|---|---|---|
| 1a | `ContentProfile` + the Coursewerk OER profile, permissions by path class, `delete.private`, `private/README.md` server-only, ratchet scan | — |
| 1b | Course operations: `courseop` rows applied at the head, migration 0063, the add-chapter and draft/ready buttons switched over | a chapter appeared in 4.4 s; Mark ready landed |
| 1c | `setLicense` (owner only, licence files follow), `restoreChapter` | — |
| 1d | Uploads: route, `course_blobs` ledger (0064), blob/move/delete rules, SVG and byte checks, editor figure upload | PNG landed; unsafe SVG, a PNG named `.jpg` and an `.exe` refused |
| 1e | Door C by content | a pushed unsafe SVG and a non-owner licence change were undone within a minute |
| 1f | Publish refuses unsafe SVGs | — |
| 1g | Needs-you both-changed items; Restore the chapter | a deputy restored a removed chapter from Needs you (11 s) |

**Found by the live checks, all fixed:**

- **The course page missed a change that landed between its two reads.** It
  now reads the queue before the head.
- **The worker's store wrapper dropped `blobKnown`, so every live upload was
  refused.** It now binds every method, with a test.
- **The SVG check would have blocked 123 of GenChem's 128 real figures.**
  Their standard DOCTYPE line and embedded raster images are now accepted,
  and the check was tested against all 128 figures.
- **Restore offers missed the deputy.** A deputy is a co-author with
  `deputy_until`, so the offers now go through `course_role_of`.
- **No both-changed item had ever been raised (A10 gap).** Those items are now
  raised for every such file.

## Round 1 audit (2026-10-29)

**2 HIGH, 5 MEDIUM, 7 LOW.** All are fixed except L2 and L7.

- **H1 (K1.11):** the SVG check could be bypassed in several ways:
  - namespace-prefixed `script` (`<x:script>`);
  - a comment strip that hid a real tag inside CDATA;
  - entity-encoded and tab-split `javascript:`;
  - `animate`/`set` on `href`;
  - `@import`;
  - `https:\\` links.

  **Now:** an allowlist over every tag, comments and CDATA included, on local names; link values are decoded before checking; `<style>` and `style=` are checked for imports and outside URLs. All the payloads are refused, and 128 of 128 real figures pass.
- **H2 (K1.14):** a figure added to an instructor-only document went to the published `assets/` folder. **Now:** the profile's `figureFolder` puts a private document's figures under `private/instructor/figures/`, and the upload route refuses a public target for a private document.
- **M1 (K1.19):** re-sending the same bytes added no ledger row, so the hourly counts never rose. **Now:** every attempt is counted by the rate limiter, per person and per course, and the same bytes already in the course skip the GitHub call.
- **M2:** Restore wasn't idempotent: two clicks gave two copies. **Now:** it answers the item first and queues only if that succeeded.
- **M3:** a same-named figure from another part became a both-changed kept version, so everyone else saw the wrong picture. **Now:** the editor adds a random suffix, and the route refuses a name already holding different bytes (409).
- **M4:** a Door C undo was refused as a whole when the restored SVG failed today's check. **Now:** undo rows skip the content checks.
- **M5:** Door C fetched pushed binaries unbounded. **Now:** a file over 4 MB is undone unread, and at most 50 files are fetched per push; Publish re-checks.
- **Fixed LOWs:**
  - **L1:** a truncated before-tree no longer turns into deletes.
  - **L3:** the licence regeneration is queued after the undo.
  - **L4:** unknown text extensions are text.
  - **L5:** `private/README.md` moved into the profile (`serverOnlyFiles`).
  - **L6:** cosmetic; the SQL guard covers it.
- **Spec drift:**
  - queue §2.2 `enqueue_courseop` corrected to what the code does (the server inserts after `can()`);
  - "blob gone → add it again" is now in the committer.

**Open, with reasons:**
- **L2:** the pusher is matched by login, not by numeric id. Accounts are rarely renamed, and a stale login only makes an owner's licence push be undone (fail closed).
- **L7:** parallel uploads can race the hourly count. It's bounded by the per-course bucket and the 4 MB size limit.
- **Edits pushed to GitHub by collaborators may change chapter order and mode.** That's deliberate under §13.6: collaborators on GitHub are the owner's choice.

**Lesson:** pattern checks for security are only as good as their adversarial corpus; the payloads are now a regression test.
