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
          Take a document out with <strong>Download</strong>. Alembic&rsquo;s
          documents are <strong>self-contained</strong>{" "}— the editor is built into
          the file — so on your own computer you just open it in a browser and edit
          in place, with nothing to install and no account needed. Prefer to work
          with AI? Hand the file to any AI agent along with its{" "}
          <strong>agent skill</strong>, and it edits with the same structure and
          identity rules the platform uses. When you&rsquo;re done,{" "}
          <strong>Replace</strong>{" "}uploads it back — and because it returns to the
          same place, its permalink and history carry straight through, so a
          citation made before the edit still resolves.
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
          <a href="https://github.com/wangyu16/orz-coursewerk" target="_blank" rel="noreferrer">
            Coursewerk
          </a>{" "}
          is the pipeline that drives that agent end to end, producing a complete,
          ready-to-upload package — with the same provenance, accessibility, and
          consistency checks Alembic guarantees.{" "}
          <Link href="/guide/building">How a course gets built &rarr;</Link>
        </p>
      </GuideSection>

      <GuideSection heading="Upload a whole package">
        <p>
          To bring a package in, first <strong>create the course</strong> in{" "}
          <Link href="/workspace">your workspace</Link> and{" "}
          <strong>publish</strong> it — that sets up the empty course. Then open it
          and <strong>upload your .zip</strong>: Alembic validates the whole
          archive — the two-side separation, the required files, every document —
          and, if it&rsquo;s sound, fills the course in. If anything is off, it
          tells you exactly what to fix.
        </p>
        <p>
          Because the course is already published, <strong>everything commits at
          once — study guides, slides, and images and all</strong>; nothing is left
          for later. (Upload fills an <em>empty</em> course; replacing a course that
          already has content is coming later.)
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
