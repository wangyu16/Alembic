# Acceptance spec: the course workspace with a real course (frozen 2026-10-29)

What an educator should be able to do with a real, large course in the
workspace. Judged only through the running product. Amend only through the
log at the end, never quietly.

The course: "General Chemistry (testing copy)", 19 chapters; each chapter has
a concept map, a study guide, slides, an assessment guide and practice.
People: a **deputy** (may edit and publish, and approve the course plan) and a
**co-author** (may edit; may not publish).

## Block A: the course and its documents

- **A1** Signed in, the person finds the course from their workspace and opens
  it. The course page shows its documents grouped in a way that makes sense
  for a course (by kind or by chapter), with readable names, and is usable
  within about 5 seconds.
- **A2** Opening a study guide shows the text being edited next to a preview
  in which headings, tables, formulas and figures appear as a reader would see
  them. Figures are not broken images.
- **A3** The person changes a sentence. The page tells them clearly that the
  change is kept, and soon that it is saved to the course. After a full
  reload, the change is still there.
- **A4** When a second person opens the same document, each of them can see
  that the other is there; when one leaves, that notice goes away.
- **A5** When one person's saved change reaches the course, the other person,
  who has the same document open, sees it appear without reloading, and their
  own unsaved typing is not lost.
- **A6** A slides document shows its slides; the person can see more than the
  first slide and can tell which slide they are on.
- **A7** From a document, the browser's Back button and the page's own way
  back both return to the course page.
- **A8** The person can download a document as a file that opens on its own
  in a browser.
- **A9** Nothing on these pages shows a technical error message, a blank
  area where content should be, or a developer term (branch, commit, repo,
  merge, SHA) in normal use.

## Block B: publishing (as the deputy unless stated)

- **B1** The Publish page lists all 19 chapters, each with whether it is a
  draft or ready, and the state of its course plan; it says what "ready"
  means.
- **B2** Pressing Publish gives immediate feedback; the page then shows that
  publishing is under way and later the result, without the person reloading.
- **B3** After a Publish, the page gives the address of the course website;
  that website opens and shows the course's chapters, and the study guides,
  slides and practice open from it.
- **B4** The person marks one chapter as a draft and publishes: the result
  says that chapter stayed as it was and why. Marking it ready again and
  publishing brings it back.
- **B5** After someone edits a chapter's concept map, the Publish page asks
  for the course plan to be approved again for that chapter.
- **B6** The co-author can see the Publish page but cannot publish, and is
  told why.
- **B7** If the website could not be updated, the page says so and names
  what needs fixing.

## Block C: try mode (a visitor without an account)

- **C1** At /try, a visitor learns what will happen (and that nothing is
  saved), names a topic, and sees a short sample chapter being made, part by
  part, within about two minutes; each part can be opened and read.
- **C2** Entering a workshop code that does not exist gives a clear message
  and does not use up anything.
- **C3** After making a sample, the visitor can make another or leave; the
  page explains where to go for real use.

## Amendment log

(none yet)
