# History and restore v3 (foundations step 2) — mini-spec

**Status:** draft 2, 2026-10-29. G0 round 1 failed draft 1 with 5 HIGH findings; they are resolved here (§9). The scope is narrowed: whole-course restore is deferred to the owner (§8). Module A9 of the build plan.
Design: orz-family `docs/ALEMBIC-WORKSPACE-DESIGN.md` §6.4. Owner rulings
(Alembic DecisionLog, 2026-10-29 evening):
- anyone who may edit a document may restore an earlier version of it;
- restoring a whole course is owner/deputy (the design said owner; this
  changes `snapshot.restore-course`);
- History lists a document's last 50 versions.

**Ownership:** all of this is Alembic's (FD-09: mechanics). Snapshots and
restores never change what a course *is*; they move it between versions the
course has already had, through the one write path.

## 1. A document's history

- **Source:** the working repo's commits that touched the path, newest first:
  one GitHub call (`listCommits(path, per_page = 50)`), cached by the head
  the database already knows (the last landed row's head).
- **Depth:** 50 entries (the owner's ruling). A sync is one commit, and a
  both-changed outcome takes two. Moves aren't followed: a moved file's earlier
  history is under its old name, and the page links there.
- **Each entry:**
  - **when:** the commit date;
  - **who:** trusted only on commits Alembic recorded making
    (`write_queue.result.commits`, a database join) (G0r1 B2):
    - the `Alembic-Actor` trailer maps to a member's name;
    - a changeset maps to "the assistant, for <name>" (`Alembic-On-Behalf-Of`);
    - system commits read "Alembic";
    - any other commit reads "edited on GitHub" (the pusher from Door C's
      `outside` row when known), and its trailers are ignored;
  - **what:** the commit's first line;
  - **kept:** marked when the commit is a kept version (`Alembic-Kept: true`)
    from Both changed;
  - **published:** marked from a database join (`doc_versions` × `published_files`), with no GitHub call (G0r1 B10).
- **Who sees it:** members (`history.see`). Instructor-only documents follow
  the same read rule as the document.
- **Deeper history:** older versions are reachable on GitHub; the page says
  so and links there (to the owner only, who has access).

## 2. Comparing two versions

- Any two entries (or one entry against the current text): a line diff, with
  added and removed lines and unchanged runs folded.
- Text files only. Figures are compared side by side as pictures.
- Pure (`diffLines(a, b)`): linear-space Myers, with an input cap. Over the
  cap (more than 20,000 lines in either), it says "too large to compare here"
  and links to GitHub.

## 3. Restoring a document version

- **What:** brings an old version back **as the newest version**. Nothing in
  history is rewritten.
- **Who:** `history.restore-doc` for the path. That is the owner, deputy and
  co-author for paths they may edit (the owner's ruling); the agent proposes
  through its hand-in.
- **Which commits:** only commits Alembic recorded making (§1), or the parent
  of one. Either way it is **an ancestor of the head**, checked with one
  `compareCommits` call (G0r1 B4); a made-up or foreign commit is refused.
- **How:** the server reads the old content at that commit and queues one
  `restore` row with the actor:
  - text: `{path, baseVersion: <current version the person saw>, text, restoreOf: commit}`;
  - figure: `{path, baseBlob: <current blob seen>, blob: {sha}, restoreOf: commit}`.
- **Every write check applies** (G0r1 B1): kind, bytes, the SVG check and the
  regular-file mode, exactly as for an upload. A restored figure's blob must be
  the path's blob at `restoreOf` (the tree read at that commit), which is the
  second accepted source of blobs besides the upload ledger.
- **The version rule for restores** (G0r1 B6):
  - the version seen is still current → **landed**;
  - otherwise → **both changed**, the restore kept and the current version on
    top;
  - restores are **never combined**. A restore that lands is the newest
    version; a later sync from an editor that still holds the old base is
    "both changed" against it as usual (the typist's text on top, the restore
    kept and offered again).
- **Restoring a removed file** (G0r1 B7):
  - allowed for a path the person may write;
  - whether it is public depends only on its place (owner ruling 2026-10-30):
    its text is not compared with private files;
  - a removed chapter's part file is restored with `restoreChapter` (owner,
    deputy); a co-author sees "ask the owner or deputy".

## 4. "Use this version" on a Both-changed item

A Both-changed item carries the commit of the version that isn't on top: the
kept commit, or, when the typist's text went on top in one commit, that
commit's parent, i.e. the head it replaced (G0r1 B9). "Use this version" is
§3 with that commit: either person may do it if they may edit the path. It
answers the item.

## 5. Snapshots (a course at a moment) — create and list

- **Create** (`snapshot.create`: owner, deputy, co-author):
  - the name becomes the slug `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 60
    characters; a non-Latin or empty name gets `snapshot-<yyyy-mm-dd>`;
  - a taken slug gets `-2`, `-3` … (on GitHub's 422 for an existing tag, the
    next number is tried);
  - one `createTag` call on the head, and a `course_snapshots` row written in
    the same request.
- **The authority** (G0r1 B4): the row's `commit_sha`. A `snapshot/*` tag
  pushed or moved on GitHub is ignored: only tags whose row matches are
  listed.
- **List:** name, date, creator, and whether that commit was published.
- **Compare with now:** the list of documents that differ (one tree call
  each), each openable as a §2 diff.

## 8. Restoring a whole course (owner rulings 2026-10-30)

Draft 1's open points (G0r1 B3, B5, B8) are settled for easy use:
1. **What comes back:** every document that existed at the snapshot, with its text then. Documents and chapters
   added since are **kept** and listed as "added since the snapshot", each removable in one click.
2. **Undo:** a snapshot "Before restoring to <name>" is made first.
3. **No lock, no agent pause:** the restore is one write through the queue; an edit made meanwhile follows the usual
   version rule (the newer text on top, the other kept).
4. **Course plans:** approved only if that exact text was approved before (approvals follow content); no batch.
5. **Kept from now:** the licence, the Coursewerk version and the mechanics fields.
6. **Who:** owner and deputy (`snapshot.restore-course`).

Not built yet; it follows the agent hand-in.

## 6. Interfaces

| Seam | Addition |
|---|---|
| github-bridge | `listCommits` (exists, with path); `createTag` (exists); `listTags(prefix)`; `getBlob`, `listTreeEntries` (exist) |
| package-ops | `historyOf(commits, ours, names)` (pure); `diffLines(a, b)` (pure); restore rows in the committer: never combined, the blob-at-commit check, the write checks |
| package-contract | `snapshot.restore-course`: deputy Y (owner ruling, for §8 later); `snapshotSlug(name)` |
| migration | `course_snapshots(package_id, tag, name, commit_sha, created_by, created_at)`, members read, server writes |
| web | History page per document (list, compare, restore); "Use this version" on Both-changed items; Snapshots on the course page (create, list, compare) |

## 7. Claims (H.n)

- **H.1** A document's History lists its last 50 versions from the working
  repo with when, who (mapped from trailers, never from a commit's claimed
  author alone), what, and kept and published marks. One GitHub call per page
  view, cached by head.
- **H.2** Comparing two versions shows added and removed lines; inputs over the
  cap are refused with a link, and the diff is linear in space.
- **H.3** A restore brings the old version back as the newest one through the
  write path. If the document changed since it was seen, both are kept. Only
  people who may edit the path can restore it.
- **H.4** A restore row can reference a blob only at its path in this course's
  history; a foreign or made-up blob is refused.
- **H.5** "Use this version" on a Both-changed item restores the kept version
  and answers the item.
- **H.6** A snapshot is a tag on the working repo plus a row; names never
  collide.
- **H.7** A whole-course restore (§8) brings back the snapshot's documents, keeps those added since, makes a
  "Before restoring" snapshot first, and keeps the licence and mechanics. (Not built yet.)
- **H.8** A restore references only commits that are ancestors of the head.
  Restored content passes every write check and a restore is never combined.
  Whether a file is public depends only on its place (owner ruling 2026-10-30).

## 9. Review resolutions (G0 round 1)

| Finding | Resolution |
|---|---|
| B1 restores skip write checks | every §11.4/§2.6 check applies to restored content (§3) |
| B2 forged "who" | trailers only on Alembic's recorded commits (§1) |
| B3 snapshot licence and mechanics | deferred with the whole-course restore (§8 q4) |
| B4 unproven commit; moved tags | ancestor-of-head check; the row is the authority (§3, §5) |
| B5 approvals and pause vs design | deferred to the owner (§8 q1–2) |
| B6 restores merged | never combined (§3) |
| B7 private → public by restore | refused after a move into `private/` (§3) |
| B8 snapshot deletes later work | deferred (§8 q3) |
| B9 no commit when the typist won | the parent head (§4) |
| B10 budget | database joins; snapshot comparison is one tree call each (§1, §5) |
| B11 snapshot names | slug rule, date fallback, 422 retry (§5) |
| B12 right at execution | restores re-check `history.restore-doc` at execution |
| B13 depth and renames | stated (§1) |
| B14 approvals by former deputies | with §8 |

