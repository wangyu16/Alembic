import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { RoundTripFigure, PackageFigure } from "../guide-figures";

export const metadata = {
  title: "Work offline & upload — Alembic Guide",
  description:
    "Edit a single document offline and upload it back, or build a whole course package offline with an AI agent (coursewerk) and import it as a .zip.",
};

export default function OfflinePage() {
  return (
    <GuidePageShell
      slug="offline"
      title="Work offline & upload"
      lede="Nothing traps your work inside Alembic. Take one document out and bring it back, or build an entire course package offline and upload it whole."
    >
      <GuideSection
        heading="Round-trip a single document"
        figure={<RoundTripFigure />}
        figureCaption="Download a document, edit it anywhere, and Replace it — it keeps the same identity, so its links never break."
      >
        <p>
          On any document — study guide, slides, an asset, a private note — use{" "}
          <strong>Download</strong>{" "}to take it out, edit it in your own tools, and{" "}
          <strong>Replace</strong>{" "}to upload the edited version back. Because it
          returns to the same place, its permalink and history carry straight
          through; a citation made before the edit still resolves after it.
        </p>
      </GuideSection>

      <GuideSection
        heading="Build a whole package offline"
        figure={<PackageFigure />}
        figureCaption="A package is a public side and a private side; an agent can author both offline, then hand you a single archive."
      >
        <p>
          A whole course can be authored <strong>outside Alembic</strong>{" "}and
          brought in at once. This is where AI agents earn their keep: you supply
          the blueprint and the intent, and an agent — following the platform&rsquo;s{" "}
          <strong>agent skill</strong>{" "}— produces every document with correct
          structure, accessibility, attribution, and layout.
        </p>
        <p>
          <a href="https://github.com/wangyu16/coursewerk" target="_blank" rel="noreferrer">
            coursewerk
          </a>{" "}
          is the pipeline that drives that agent end to end, producing a complete,
          ready-to-upload package.
        </p>
      </GuideSection>

      <GuideSection heading="Import a .zip">
        <p>
          From <Link href="/workspace">your workspace</Link>, choose{" "}
          <strong>Import a .zip package</strong>. Alembic validates the whole
          archive — the two-side separation, the required files, every document —
          and, if it&rsquo;s sound, opens it as a <strong>trial</strong>{" "}you can
          review and then publish. If anything is off, it tells you exactly what to
          fix.
        </p>
        <p>
          One thing to expect: a trial lives in Alembic&rsquo;s own storage and is
          text-only, so images and PDFs are added after you publish. All of the
          text — study guides, slides, structures, notes — comes in right away.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
