# History and restore v3 (foundations step 2) — mini-spec

**Status:** draft 1, 2026-10-29, for gate G0. Module A9 of the build plan.
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
  one GitHub call (`listCommits(path, per_page = 50)`), cached by head commit.
- **Each entry:**
  - **when:** the commit date;
  - **who:** the `Alembic-Actor` trailer mapped to a member's name; else
    "edited on GitHub" with the committer's login; the agent shows as "the
    assistant, for <name>";
  - **what:** the commit's first line;
  - **kept:** marked when the commit is a kept version (`Alembic-Kept: true`)
    from Both changed;
  - **published:** marked when this version of the file is what the website
    shows (`published_files` holds the path with this version).
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

- **What:** brings an old version back **as the newest version**. Nothing is
  rewritten in history.
- **Who:** `history.restore-doc` for the path. Owner, deputy and co-author for
  paths they may edit (the owner's ruling); the agent proposes through its
  hand-in.
- **How:**
  1. The server reads the old text (or blob) at the chosen commit.
  2. It queues **one `restore` row** with the actor:
     `{path, baseVersion: <the current version the person saw>, text: <old text>}`,
     or `{path, baseBlob, blob: {sha}}` for a figure.
- **The blob ledger:**
  - A `restore` row may reference a blob only if that blob is already in this
    course's history at that path. The committer checks that the blob is the
    path's blob at the named commit, by reading the tree at that commit.
  - This is the second accepted source of blobs besides the upload ledger
    (contract v3 §11.2), and it can't import foreign bytes.
- **The version rule:**
  - the version seen is still current → **landed**;
  - someone changed the document since → **both changed** (the restore is kept,
    the current version stays on top, and a Both-changed item says so).
- **Restoring a removed file:**
  - allowed when the path is classifiable and writable by the person;
  - a removed chapter's part file goes through `restoreChapter` instead (the
    page offers it).
- **History** shows the restore as its own entry ("Restored the version of
  Oct 3").

## 4. "Use this version" on a Both-changed item

A Both-changed item carries the kept commit (`keptCommit`). "Use this version"
is §3 with that commit: either person may do it if they may edit the path. It
answers the item.

## 5. Snapshots (a course at a moment)

- **Create** (`snapshot.create`: owner, deputy, co-author):
  - a name ("Fall 2026") becomes a tag `snapshot/<slug>` on the working repo
    head, where the slug is lowercase and hyphen-joined;
  - a name already used gets `-2`;
  - one GitHub call, made by the server.
- **List:** the course's `snapshot/*` tags, with name, date and creator (from a
  `course_snapshots` row written when the tag is made; the tag is the
  authority for the commit).
- **Restore a whole course** (`snapshot.restore-course`, owner/deputy):
  - a course operation `restoreSnapshot(tag)`, applied at the head by the
    committer;
  - it reads the tree at the tag and, in **one commit**, writes every path that
    differs:
    - text and blobs by blob id (blobs already in the repo's history);
    - removes paths the snapshot doesn't have;
  - it never touches server-only paths, harness records (`private/coursewerk/`)
    or `private/sources/` (their state is the database's), or `.github/`;
  - the restored manifest must pass the profile's validity (contract v3 §13.2),
    else the restore is refused;
  - it is shown first as a summary ("brings back 3 chapters, changes 41 files,
    removes 2") that the person confirms.
- **Course-plan approvals:** approvals are by version (`approve_part`). A
  restored plan version that was approved before is approved again by itself;
  one that wasn't goes to the Publish page as usual.
- **Published versions:** a snapshot made on a published commit is marked; the
  citable public name is later work (§6.4 "matching public version").

## 6. Interfaces

| Seam | Addition |
|---|---|
| github-bridge | `listCommits` (exists, with path); `createTag` (exists); `listTags(prefix)`; `getBlob`, `listTreeEntries` (exist) |
| package-ops | `historyOf(commits, members, published)` (pure); `diffLines(a, b)` (pure); restore rows in the committer: the blob-at-commit check; course op `restoreSnapshot(tag, commit)` in `applyCourseOp` with the tree read by the committer |
| package-contract | `snapshot.restore-course`: deputy Y (owner ruling); `snapshotSlug(name)` |
| migration | `course_snapshots(package_id, tag, name, commit_sha, created_by, created_at)`, members read, server writes |
| web | History page per document (list, compare, restore); "Use this version" on Both-changed items; Snapshots on the course page (create, list, restore with summary) |

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
- **H.7** Restoring a snapshot is one commit at the head, by owner/deputy
  (re-checked). It never touches server-only paths, harness records, source
  pointers or `.github/`; it is refused if the result isn't a valid course;
  and it is confirmed after a summary.
