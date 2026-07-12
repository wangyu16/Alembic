import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { StepsFigure } from "../guide-figures";

export const metadata = {
  title: "Getting started — Alembic Guide",
  description:
    "Your first package, end to end: sign in, create a package, write the blueprint and a study guide, preview, and publish.",
};

export default function StartPage() {
  return (
    <GuidePageShell
      slug="start"
      title="Getting started"
      lede="Your first course, from a blank page to a published website. The loop is short: create, author, preview, publish — and you can stop and come back at any point."
    >
      <GuideSection
        heading="The shape of the work"
        figure={<StepsFigure />}
        figureCaption="Create a package, author its documents, preview them, and publish — the last step is always yours to approve."
      >
        <p>
          You sign in with GitHub — that&rsquo;s where your materials will live, so
          they stay yours. Everything after that speaks teaching, not tooling.
        </p>
      </GuideSection>

      <GuideSection heading="1 · Create a package">
        <p>
          From <Link href="/workspace">your workspace</Link>, give your course a
          title, choose what it calls its units (chapter, module, week…), and pick
          a license. That&rsquo;s it — the package opens as a{" "}
          <strong>trial</strong>, saved in Alembic with nothing on GitHub yet. You
          can work as long as you like before publishing.
        </p>
      </GuideSection>

      <GuideSection heading="2 · Author the blueprint, then the documents">
        <p>
          Start with the <strong>blueprint</strong>{" "}— a concept map of what
          you&rsquo;ll teach and an assessment guide for how you&rsquo;ll judge it.
          It&rsquo;s plain text and quick to write (see{" "}
          <Link href="/guide/structure">Documents &amp; collections</Link>). From
          there, the <strong>study guide</strong>{" "}and the rest of the course
          materials are assembled, with AI doing the careful editing. You review
          and decide what&rsquo;s ready.
        </p>
      </GuideSection>

      <GuideSection heading="3 · Preview">
        <p>
          At any time, preview the student-facing pages exactly as they&rsquo;ll
          appear once published — so there are no surprises. Nothing is public
          until you choose to publish.
        </p>
      </GuideSection>

      <GuideSection heading="4 · Publish">
        <p>
          When you&rsquo;re ready, <strong>publish</strong>. Alembic builds a
          course website under your own account and moves your package onto GitHub
          — all behind the scenes. Publishing is deliberate and always needs your
          explicit approval; nothing goes out on its own. See{" "}
          <Link href="/guide/publish">Publishing</Link>{" "}for what happens and what
          you get.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
