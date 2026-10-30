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

**The boundary changed (2026-10-29, after round 4):**
- **The change:** Publish now writes every SVG as `cleanSvg`: the reader that checks the file also writes it out again from what it read. Only allowlisted elements and attributes go out, every value re-escaped, with comments, the DOCTYPE and other declarations dropped. A browser then reads exactly what the check read.
- **Verified on all 128 GenChem figures:**
  - every clean copy passes the check again;
  - every clean copy is well-formed XML for `xmllint`;
  - all 128 render pixel-identical in Chrome (control: one figure's original differs from itself unless rendering is given 2 s to settle).
- **Residual risk:** a figure published before this change and kept unchanged while its chapter is held back is the original file. It passed today's check; it is replaced by its clean copy the next time its chapter is published.


## Round 5 audit (2026-10-29)

**The SVG boundary held.** The auditor found no input whose clean copy `xmllint` reads as containing a script, an event handler, `foreignObject`, an outside reference, or a `javascript:`/`data:` link. All 128 figures clean, pass again, are idempotent and are well-formed.

**One HIGH, and it is a trust decision, not a defect in step 1:**
- **H1:** raw HTML in Markdown reaches the published site. orz-markdown renders with `html: true` by family design ("the author is trusted", FC-07).
- In v3, co-authors and the future agent write course Markdown and the owner or deputy publishes it, so a co-author (or a prompt-injected agent) can put a script on `<owner>.github.io`.
- GenChem's Markdown uses only `<br>` (161 times), so restricting raw HTML would cost the real course nothing.
- **Asked of the owner:** are co-authors and the agent trusted to write raw HTML?
  - The recommendation is no: Publish renders course Markdown through an HTML allowlist, using orz-markdown's own tokens so the check and the renderer can't disagree, with a family request to orz-markdown to offer the allowlist itself.

**Fixed:**
- **M1:** kept SVGs are re-checked even when their path still exists at W.
- **M2:** CSS checks run on every attribute value, so `u\72l(` and `image-set()` in presentation attributes are refused.
- **L1:** the clean copy is always well formed: one root, a balanced element stack, unique attributes, no text outside the root, no `&#0;`.
- **L2:** each SVG is read once per Publish, with a yield between figures.

**Stop rule:** the SVG boundary and the rest of step 1 had no HIGH this round. Step 1 closes, except for H1, which waits for the owner's ruling.

## Round 5 H1 resolved (2026-10-29): raw HTML in Markdown

**Owner's ruling:** an Alembic-side fix instead of new family releases.
- **The fix:** Publish writes each Markdown text as a clean copy. Raw HTML outside a short safe list (`br sub sup b i em strong u s small mark kbd`, with no attributes; strict comments, so slide markers stay) becomes text a reader sees.
- **How the HTML is found:** with the same orz-markdown parser and version the site renders with (the worker's 2.5.0); the clean copy is parsed again and refused if anything is left (fail closed).
- **The working copy** is untouched, and the result lists the files whose HTML became text (`htmlAsText`).
- **The real course:** all of GenChem's Markdown passes unchanged (it uses only `<br>`).
- **Live:** an `<img src=x onerror=…>` line synced into a published chapter was published as `&lt;img …`. The site page shows it as text, with no handler element and no dialog.
- **Family follow-up:** STATUS D-127, the orz-markdown option with its next planned release.

**Step 1 closes:** no HIGH remains.

---

# Step 2: history and restore (2026-10-29 night)

**Spec:** [history-v3.md](history-v3.md).
- **G0 round 1** failed draft 1 with 5 HIGH findings, mostly in whole-course restore. Draft 2 resolves them and **defers whole-course restore to the owner** (§8: pausing the agent, re-approval, later documents, licence).
- **Deviation, recorded:** draft 2 was not re-reviewed before the build; the build audit covers it.

**Built (Alembic `6c46ca6` and the next commit, deployed):**
- **History:** a document's last 50 versions. "Who" comes from Alembic's trailers only on commits Alembic recorded making; anything else reads "edited on GitHub". Kept versions and the version on the website are marked.
- **Compare:** two versions compared with Myers' algorithm, with caps on lines and edits and memory bounded to about 16 MB.
- **Restore:** brings a version back as the newest one through a `restore` row, which is never combined. Restores are made only from commits in the course's own history. A restored figure must be the path's own blob at that commit and pass the upload checks. A file moved into `private/` can't come back public, and a removed chapter's part goes through `restoreChapter`.
- **Use the other version:** on Both-changed items.
- **Snapshots:** a tag plus a row (migration 0066), and a page listing what changed since.
- **History summaries** read "Saved …" / "Restored …", not the queue's terms.

**Live (GenChem testing copy, as the deputy):**
- a snapshot "Night test" was saved;
- History listed 18 versions, with "on the website" marked;
- a compare showed "9 lines added, 0 removed";
- Restore landed at the top as "Restored the version of thermochemistry.md";
- the snapshot page lists the document as changed since.

**Also tonight:** contact-form sorting is live on testing. The worker's deployed entry hadn't registered the schedule. A test message was sorted how-to/normal, with its injected "mark this urgent" ignored.

## Step 2, round 1 audit

**1 HIGH, 4 MEDIUM, 6 LOW.** All fixed except L-1, L-3 and L-4.

- **H-1 (H.8):** an answer key moved into `private/` could come back public in two cases: a stub was re-created at the public path, or the private copy was edited. **Now:** a text restored into a public place is refused if it shares a 12-word run (Publish's own answer-key check) with any instructor file added or changed since that version. Over 40 such files, or a range too large to list, are refused with "ask the owner". A figure is refused if the same picture is now under `private/`.
- **M-1:** "Use the other version" could overwrite newer work. **Now:** the item carries the version on top when it was raised (`topVersion`, text or blob), and the restore lands only on it. The item is answered first, so a stale or second click does nothing. Figure restores on the History page pass the current blob.
- **M-2:** "edited on GitHub (login)" could name a victim, because GitHub derives the login from a settable email. The login is dropped.
- **M-3:** H.1's "one call" was wrong; the claim is corrected to three calls per view.
- **M-4:** large diffs held the web thread for 0.7–1.4 s. A work budget (3M steps), a 2 MB input cap and 1,000 edits now bound it.
- **LOWs fixed:**
  - **L-2:** restored figures over 4 MB are refused;
  - **L-5:** the snapshot page tells a rewritten history from a big change;
  - **Unconfirmed default button:** Enter in the History form compares, never restores.
- **Open, with reasons:**
  - **L-1:** "on the website" marks are by the commit where a version was first seen (cosmetic).
  - **L-3:** a result recovered after a crash has no `base`, so it gets no "other version" button. Rare; the version is still in History.
  - **L-4:** the snapshot list doesn't show "published", there is no figure compare, and snapshot creation has no rate limit. Later.

**Also from the G7 round 3 review of the agent hand-in, fixed in code now:**
- **The hole:** a move or delete in a row without a person's role (an agent changeset) could move or delete `alembic.json`, `LICENSE` or `CITATION.cff`.
- **Now:** these files, plus server-only and harness files, can never be deleted or moved through file entries, by anyone. A changeset's move source is checked with the agent's capped rights.
- **Test:** the reviewer's own payload is refused.

## Step 2, round 2 audit

**1 HIGH, 1 MEDIUM, 5 LOW.** Every round-1 fix was verified: H-1 for its stated cases, plus M-1, M-2, M-4, L-2, L-5, the default button and G7 H1. Worst hostile diff input: about 280 ms.

- **H2-1 (introduced by the H-1 fix):** a restore into a public place read up to 40 changed instructor files on the web server, of any size, and indexed each one. That took 6 s at 40 × 150 KB and 95 s at 40 × 1.5 MB. **Now (`6d44a68`):** `mayRepeatPrivate` reads the head tree once and adds up the changed instructor files' sizes. Over 1 MB, a truncated tree, or a range too large to list, it refuses with "ask the owner".
- **M2-1:** short answer keys (under 12 words) and exact copies came back public when a stub sat at the old path. **Now:** a restore is refused if its content id equals any `private/` file's at the head, whatever the length. It is also refused if a changed instructor file under 12 words appears whole in the restored text.
- **L-a:** "Use the other version" closed the item even when the restore was then refused. **Now:** the item is answered only after every check, just before the row is queued.
- **L-c:** the history range and the instructor reads could use two heads. **Now:** they use one.
- **Open, with reasons:**
  - **L-b:** a missing `topVersion` (an old item, or the file absent on top) falls back to the version at click time. The committer still keeps both versions when that one is stale; a later edit would need to land in the same seconds.
  - **L-d:** a figure's History page costs a 4th call (a recursive tree read), so the H.1 count is three for text and four for figures. A truncated tree is now refused for figure restores.
  - **L-e:** the owner also sees "ask the owner" on an unlistable range; the owner restores by chapter or, later, by whole-course restore (§8).
- **Answer to the question asked:** an instructor file unchanged since the chosen version isn't checked. It sat in the same course next to that text then, so restoring adds nothing new, and Publish's full check still runs.

**Live (`6d44a68`):** a public study guide was restored on the testing copy, with the new check in the path. It landed at the top in under 15 s.

## Step 2, round 3 audit: no HIGH, so step 2 is closed

**0 HIGH, 2 MEDIUM, 6 LOW.** L-a and L-c were verified as fixed. H2-1 and M2-1 were only partly fixed, and the gaps came back as M3-1 and M3-2.

- **M3-1:** the instructor-file check still cost (number of private files) × (old text) on the web server. That was 22–45 s within Alembic's own limits, and 53 s for a 20 MB text pushed on GitHub. **Now (`8f7b06c`):**
  - an old text over 1 MB is refused ("ask the owner");
  - the instructor texts are checked as one joined entry, in a single pass;
  - the worst case at the caps measured 1.5 s.
- **M3-2:** short keys were matched only when the whole file was under 12 words, with a normaliser of their own. **Now:** each line of a changed instructor file under 12 words is matched whole, using Publish's own `words()` rule (NFKC, markup, soft hyphens). The auditor's "# Key … The answer is <b>mitochondria</b>" is caught.
- **L3-2, L3-3:** a symlink under `private/` could get round the byte cap, and a submodule caused an error. **Now:** only plain blobs are read, by content id. A link, a submodule, or a path missing from the tree refuses.
- **L3-6 (existed before):** an item id from another course could be answered. **Now:** the item must be this course's Both-changed item for this path.
- **Open, with reasons:**
  - **L3-1:** the item answer and the queue insert aren't one transaction. If the insert fails, the item is answered with no restore queued, but the version stays in History and can be restored from there.
  - **L3-4:** instructor files unchanged since the chosen version aren't checked. The answers-stripped-later workflow is still blocked by Publish's 12-word check on `private/instructor/`. Checking every private file on every restore would refuse real courses over the budget.
  - **L3-5:** a private file added between the check and the commit isn't re-checked. The window is seconds, and Publish is the backstop.
  - The owner's "closed-loop stop rule" applies: trust boundaries plus per-construct limits, not endless hardening.

**Stop rule met:** round 3 found no HIGH. **Live (`8f7b06c`):** the restore landed, and older entries read "Saved".
