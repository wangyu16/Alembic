# Sharing elements (v3) — mini-spec

**Status:** draft 1, 2026-10-30 (overnight). Owner ruling (2026-10-30): "Element
level sharing is allowed. A nice graphic illustration, a chart/diagram, a block
of math of important proof, etc. can be shared as individual elements allowing
other people to use." Defaults approved the same evening: anyone who may edit a
page shares its elements; the permanent link lives on Alembic's site; "use this
element" only when the course's licence is open. Frame: family
`docs/SITE-TYPE-CONTRACT.md` §9 (Alembic's, the same for every kind of site).

## 1. What can be shared

| Element | Identity | Step |
|---|---|---|
| A figure | its path in the course (`assets/…`), published | 1 |
| A section of a page | its heading's block id (`## Title{{attrs[#blk-…]}}`), in a published page | 1 (headings that have an id); 2 (Alembic adds an id to a heading on request) |
| A math block, a diagram | stable ids on those blocks from orz-markdown (a family request) | later |

Until math blocks and diagrams have their own ids, they are shared as part of
their section.

## 2. Sharing and stopping

- **Who:** anyone who may edit the page (for a figure: the page it is shown in).
- **Where:** the document page's **Share** panel lists the page's figures that
  are on the website and its sections that have an id; each has
  Share / Stop sharing. A shared element gets a permanent address at once.
- **Only what is published is shared:** an element whose figure or page isn't
  on the website (never published, withdrawn, deleted, or the section's id no
  longer in the published version) shows "no longer available" at its address
  (HTTP 410), and comes back by itself if it is published again.
- **Stopping** ends sharing for good for that record (sharing again makes a new
  address, so an old link never silently comes back).

## 3. The permanent address

- `https://<alembic>/e/<id>` with `id = el-<12 base36>` (`newElementId`).
- The page shows the element as it is **on the course website now** (the public
  copy at the last Publish, never the working copy): a figure as the image; a
  section rendered with Alembic's renderer, its relative images pointing at the
  course website.
- **Credit and licence** on every element page: the course title, its authors
  (owner's name), the licence (with its link), a link to the page it comes from
  on the course website, and a ready citation line.
- **"Use this element"** (step 2): copy into one of one's own courses with the
  credit, offered only when the licence is open.
- **Caching:** as the old permalinks (family RULES; `TAKEDOWN_BOUND_SECONDS` =
  300): a withdrawn element stops showing within five minutes.

## 4. Records

`shared_elements` (migration 0068): `id`, `package_id`, `path`, `kind`
(`figure` | `section`), `anchor` (the block id for a section), `title` (shown on
the element page), `shared_by`, `shared_at`, `stopped_at`. Members of the course
read their course's rows; rows are written only by the server (the share action
re-checks the right to edit the page). The public element page reads with the
service role, and only active rows.

## 5. Discover (step 2)

Shared elements of public courses are listed in Discover's elements tab, from
`shared_elements` joined with `published_files` (only what is on a website).
Discover ranks nothing by content (contract §11).

## 6. Claims

- **K1.28** Only an element whose figure or page is on the course website can be
  seen at its address; anything else answers "no longer available"; stopping
  sharing ends that address for good.
- **K1.29** Sharing and stopping need the right to edit the page; the element
  page always carries the course, its authors, the licence and the source page.
