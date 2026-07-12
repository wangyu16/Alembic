import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { PermalinkFigure } from "../guide-figures";

export const metadata = {
  title: "Citing, versions & links — Alembic Guide",
  description:
    "How Alembic keeps references stable: permalinks that survive edits and moves, inserting a figure once and reusing it, and named term snapshots you can cite.",
};

export default function PermalinksPage() {
  return (
    <GuidePageShell
      slug="permalinks"
      title="Citing, versions & links"
      lede="Open resources are only useful if references to them hold. Alembic gives every document and figure a stable address, lets you insert once and reuse anywhere, and lets you freeze a term you can cite."
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
          anyone, without an account.
        </p>
      </GuideSection>

      <GuideSection heading="Snapshots — freeze a term you can cite">
        <p>
          Teaching evolves, but sometimes you need to point at{" "}
          <strong>exactly what you taught</strong>. Take a named{" "}
          <strong>snapshot</strong>{" "}each term — &ldquo;Fall&nbsp;2026&rdquo; — and
          Alembic freezes the whole course at that moment. You can cite it,
          compare it against a later version, or restore it. Your day-to-day
          edits keep moving forward; the snapshot stays put as a citable record.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
