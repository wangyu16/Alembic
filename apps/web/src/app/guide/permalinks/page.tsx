import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { PermalinkFigure } from "../guide-figures";

export const metadata = {
  title: "Citing, versions & links — Alembic Guide",
  description:
    "How Alembic keeps references stable: permalinks that survive edits and moves, inserting a figure once and reusing it, and naming each term's version of your course.",
};

export default function PermalinksPage() {
  return (
    <GuidePageShell
      slug="permalinks"
      title="Citing, versions & links"
      lede="Open resources are only useful if references to them hold. Alembic gives every document and figure a stable address, lets you insert once and reuse anywhere, and lets you name each term's version of your course."
    >
      <GuideSection
        heading="A link that doesn't break"
        figure={<PermalinkFigure />}
        figureCaption="Rename or move a document and its permalink keeps pointing to it — the citation still works."
      >
        <p>
          Every document and every asset has a <strong>permalink</strong>{" "}— a
          stable web address that belongs to it for good. Rename the file,
          reorganize your course, move a figure from one chapter to another: the
          permalink keeps pointing to the right thing. A colleague who cited your
          figure, or a student who bookmarked a page, never hits a dead link.
        </p>
      </GuideSection>

      <GuideSection heading="Insert once, reuse anywhere">
        <p>
          Put a figure, structure, or plot in your <strong>Assets</strong>{" "}
          collection once, then <strong>insert</strong>{" "}it into any document. What
          gets placed is the asset&rsquo;s permalink, so the same figure can
          appear in a study guide, a slide, and a practice set — and if you share
          the document, the figure travels with it and still renders, because the
          link is absolute, not a fragile relative path.
        </p>
        <p>
          The same mechanism is how you <strong>cite</strong>: copy a
          document&rsquo;s permalink and it resolves to exactly that resource, for
          anyone, without an account. A permalink always shows the{" "}
          <strong>current</strong>{" "}version of the file; links to one particular
          earlier version are planned, not yet available.
        </p>
      </GuideSection>

      <GuideSection heading="Snapshots — name a term's version">
        <p>
          Teaching evolves, but sometimes you want to mark{" "}
          <strong>what you taught</strong>. Take a named{" "}
          <strong>snapshot</strong>{" "}each term — &ldquo;Fall&nbsp;2026&rdquo; — and
          Alembic records the whole published course as it stood at that moment,
          under that name, and you can add a citation file to the course. Your
          day-to-day edits keep moving forward; every earlier version is kept.
        </p>
        <p>
          To undo changes to one chapter, open its <strong>History</strong>{" "}and
          restore an earlier version. Comparing two snapshots, or restoring a whole
          course from one, is planned but not yet available.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
