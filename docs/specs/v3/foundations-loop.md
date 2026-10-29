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

## Round 2 audit (2026-10-29)

**2 HIGH, 2 MEDIUM, 3 LOW.** All are fixed.

**Round 1's fixes, checked:**
- **Held:** H2, M2, M3, M4, M5, L1, L3, L5.
- **Not held:**
  - **H1:** still bypassable (below).
  - **M1:** the buckets counted per server instance.
  - **L4:** opened a regression (below).

**HIGH:**
- **H1 (K1.11):**
  - **Was:** the regex scanner never saw tags whose namespace prefix starts with a non-ASCII letter (`<é:script>`); processing instructions (`<?xml-stylesheet href=…?>`), CSS escapes (`@\69mport`, `u\72l(`), `image-set()` and `fill="url(https://…)"` passed.
  - **Now:** the regexes are replaced by one linear left-to-right reader:
    - every element and end tag is checked against the allowlist by local name;
    - comments and CDATA are skipped as XML skips them;
    - any processing instruction but the leading `<?xml …?>` is refused, and so are `ENTITY`/`ATTLIST`/`ELEMENT` declarations and DOCTYPE subsets;
    - a backslash anywhere in CSS is refused;
    - every `url()`, in any attribute, must point inside the figure.
  - All the payloads from rounds 1 and 2 are refused, and 128 of 128 real figures pass.
- **H2:** catastrophic backtracking: 80 KB of `<a` took 20 s, and a 4 MB file would have taken hours, blocking the shared worker. The reader is linear, and a timing test bounds it (400 KB of hostile input in under 1.5 s each).

**MEDIUM:**
- **M3 (from L4):**
  - **Was:** "unknown extension = text" let `.xhtml`/`.xml`/`.xsl`/`.js` be stored and published; Pages runs scripts in them.
  - **Now:** an explicit text list (`md json cff txt yml yaml csv bib tex gitignore`).
  - Plain HTML is a later, deliberate addition (FD-10), so `.html` is off the list too.
- **M4 (M1):** the upload buckets are counted in Postgres, shared across instances.

**LOW:**
- **L5:** Restore is queued under a key derived from the item before the item is answered. A failure leaves it open; two clicks are one row.
- **L6:** Door C counts failures per event (migration 0065). Failing events go to the back, and are set aside after 10 attempts, so they no longer starve every course.
- **L7:** a malformed upload header is a 400, not a 500.

**Found while fixing, for Coursewerk (D-126 item 9):** GenChem holds 32 saved third-party web pages under `metadata/evidence/*.html` (rights evidence). `metadata/` is a public space, so they are projected to the public copy. Whether evidence snapshots should be published at all is a content question for Coursewerk. Alembic no longer accepts edits to them.

## Round 3 audit (2026-10-29)

**2 HIGH, 2 MEDIUM, 2 LOW.** All are fixed (Alembic `9b8badd`, deployed).

- **HIGH-1:**
  - **Was:** scripts reached the published site through `.html` files. After `.html` left the text list, Door C and Publish treated an unknown kind as harmless: GenChem's 32 evidence snapshots (all containing `<script>`) were projected and served on `<owner>.github.io`.
  - **Now:**
    - Publish leaves out any file of a kind the site can't serve safely and lists it (`leftOut`); a copy published earlier leaves the public copy and the site.
    - Door C undoes such pushes.
  - **Live:** after one Publish, the public copy and `gh-pages` hold 0 evidence HTML files and 0 `.js` files.
- **HIGH-2:** the reader was quadratic on leading whitespace plus repeated `<?xml?>` (400 KB took 27 s). The document start is now computed once, and the timing test includes this shape.
- **MEDIUM-1:** encoded `url(` in presentation attributes, very long character references (`&#00000000106;`) and nested `<style>` got past the check. Now:
  - values are decoded before the url check;
  - references of any length are decoded, and an impossible one is refused;
  - nested styles are refused.
- **MEDIUM-2:**
  - **Was:** Door C set a push aside after 50 seconds, outages included, silently.
  - **Now:** GitHub outages and rate limits don't count, and a push set aside raises an interrupting item for the course.
- **LOW-1:** a stale page can't restore after the item was answered.
- **LOW-2:** a move keeps the extension, so a text file can't become an SVG unchecked.

**Unconfirmed, recorded:** `xml:base` on an ancestor, `<use>` of a text file as an SVG resource, and an XHTML default namespace on allowlisted names. No executable path was found; to revisit if browsers change.

## Round 4 audit (2026-10-29)

**1 HIGH, 1 MEDIUM, 1 LOW.** All of round 3's fixes held, apart from part of HIGH-1 (below).

- **HIGH-A:**
  - **Was:** a `>` inside a quoted DOCTYPE id ended the declaration early in the check but not in a browser, so a "comment" hid a real `<script>` (confirmed with libxml2).
  - **Now:** only the standard DOCTYPE forms, and only the standard XML declaration, are accepted, each matched in full. Anything else is refused.
- **MEDIUM-A:** files published before the safety rule stayed public while their unit was held back. Earlier-published files of an unsafe kind, and kept SVGs that fail today's check, now leave.
- **LOW-A:** many large crafted SVGs could hold the worker. Publish now yields between SVG checks. Door C's worst case (50 crafted 4 MB SVGs pushed by a collaborator, about 2.5 min) is accepted and recorded.

**Pattern across rounds 1–4:** every HIGH since round 1 was in one place: deciding whether an SVG is safe by *reading* it, where the check and a browser can disagree. That race doesn't end by adding cases. Per the owner's standing preference (trust boundaries over endless hardening), the next step changes the boundary: Publish writes every SVG out again from what the check understood (allowlisted elements and attributes only, values escaped), so a disagreement can't carry anything through.
