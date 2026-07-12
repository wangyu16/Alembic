import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { PublishFigure } from "../guide-figures";

export const metadata = {
  title: "Publishing — Alembic Guide",
  description:
    "What publishing does: builds a course website under your own account that works without Alembic, plus this-term materials and citable snapshots.",
};

export default function PublishPage() {
  return (
    <GuidePageShell
      slug="publish"
      title="Publishing"
      lede="Publishing is the deliberate step that turns your trial into a real, public course — hosted under your own account, and yours to keep even if you never open Alembic again."
    >
      <GuideSection
        heading="What publishing does"
        figure={<PublishFigure />}
        figureCaption="Your package becomes a course website hosted under your own account; everything keeps working without Alembic."
      >
        <p>
          When you publish, Alembic sets up the storage under <strong>your</strong>{" "}
          account and builds a course website from your materials. The routine
          technical work — creating the storage, moving files, building the site —
          is handled for you. The result is a normal website you own; nothing
          depends on Alembic staying around.
        </p>
        <p>
          Publishing always needs your <strong>explicit approval</strong>. It never
          happens automatically, and listing a course publicly is a separate,
          equally deliberate choice.
        </p>
      </GuideSection>

      <GuideSection heading="This term">
        <p>
          A published course has a <strong>&ldquo;this term&rdquo;</strong>{" "}area for
          the class you&rsquo;re teaching now — announcements and assignments that
          are timely rather than timeless. When you start a new term, last
          term&rsquo;s materials are kept for reference and the page moves on. It
          keeps the durable course clean while still serving today&rsquo;s students.
        </p>
      </GuideSection>

      <GuideSection heading="Snapshots — cite exactly what you taught">
        <p>
          Take a named <strong>snapshot</strong>{" "}each term
          (&ldquo;Fall&nbsp;2026&rdquo;) and Alembic freezes the whole course at
          that moment. You can cite it, compare it against a later version, or
          restore it — while your everyday edits keep moving forward. See{" "}
          <Link href="/guide/permalinks">Citing, versions &amp; links</Link>.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
