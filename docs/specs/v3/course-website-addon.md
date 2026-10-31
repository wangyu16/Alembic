# The course-website add-on — mini-spec

**Status:** draft 1, 2026-10-30 (overnight). Owner rulings (2026-10-30): course
websites need per-semester items and private items such as exams, as an add-on
outside Coursewerk, kept as a small side package within Alembic. The
current-semester area is **flexible**: a per-term place where the instructor adds
any files, with recommended ones offered as starters. The **course home page** is
an editable page the instructor arranges (later also the assistant, on their
instructions). Frame: family `docs/SITE-TYPE-CONTRACT.md` §10.

## 1. What a course gets when it is switched on

- **A home page** (`home.md`, a page like any other): the website's front page
  shows it first, above the chapter list. The instructor writes it freely
  (welcome, how to use the course, links, a schedule summary).
- **This semester** (`current/<term>/`, one folder per term): the instructor
  adds any files there (pages and figures, data files). One-click starters for
  the recommended pages: **syllabus, schedule, announcements, assignments,
  office hours**. Nothing is required.
- **Exams** (`private/exams/`): private, never published, for owner, deputy and
  co-authors.

## 2. Terms

- The course keeps a list of terms and a current one in its settings
  (`alembic.json`: `terms: [{ slug, title }]`, `currentTerm`). A term's slug is
  made from its title ("Fall 2026" → `fall-2026`).
- The owner or deputy adds a term, and makes one current. A new term can start
  as a copy of the previous term's pages (one click; the copies start as drafts).
- **Only the current term's pages are on the website.** When the current term
  changes, the previous term's pages leave the website at the next Publish; they
  stay in the course's files and history.
- Pages in the term folder follow the usual statuses (draft / completed /
  withdrawn); figures and data files there are published as they are, within the
  current term.

## 3. The website

The front page (when the course has no `orz-site.json` of its own): the course
title, the **home page's content**, then **This semester** (the current term's
published pages, by name), then the chapters as before, then the README and the
course map links.

## 4. Switching it on and off

- On and off: owner or deputy, in **Course options**.
- On: the home page is created from its starter (a draft), and a first term from
  the current season if there is none.
- Off: nothing is deleted; the home page and term folders stay in the course
  (and in history) but are not published until it is switched on again.

## 5. Interim (recorded deviation from contract §10)

Alembic's core still reads one site type for every course (the profile bridge),
so the add-on's places (`home.md`, `current/`, `private/exams/`) are accepted in
every course, and the add-on being on or off decides what Publish takes from
them and what the workspace offers. Making placement per course comes with the
core reading definitions directly (contract §14).

## 6. Claims

- **K1.30** With the add-on on, only the current term's term files go out (pages
  by their status), and the home page goes out by its status; with it off, none
  of them do. The front page shows the home page first and the current term's
  pages.
- **K1.31** Terms and the add-on switch are the owner's or deputy's; a term's
  slug is made from its title; starters never overwrite an existing file.
