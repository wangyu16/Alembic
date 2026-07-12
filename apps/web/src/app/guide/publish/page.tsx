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
        figureCaption="Publishing moves your course out of Alembic and into your own GitHub, where GitHub Pages serves it — Alembic is only the bridge."
      >
        <p>
          Until you publish, your course lives in Alembic&rsquo;s{" "}
          <strong>temporary storage</strong>. Publishing moves it{" "}
          <strong>out of Alembic and into your own space on GitHub</strong>{" "}— the
          same account you signed in with. Those repositories belong to you and are
          entirely independent of Alembic; <strong>GitHub Pages</strong>{" "}—
          GitHub&rsquo;s own free website hosting — turns them into a live course
          website.
        </p>
        <p>
          So Alembic is really just the <strong>bridge</strong>: it handles the
          setup and the transfer, but once your course is on GitHub, the site and
          its content live there on their own. If Alembic disappeared tomorrow,
          your published course would keep working — that is exactly why it&rsquo;s
          built this way.
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
