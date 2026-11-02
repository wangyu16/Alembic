import Link from "next/link";
import { GuideNote, GuidePageShell, GuideSection, GuideShot } from "../_components/guide-page-shell";

export const metadata = {
  title: "Try it without an account — Alembic Guide",
  description:
    "Try Alembic with no account: name any topic and watch a short sample chapter being written, then open each part in the real editor. Nothing is kept.",
};

export default function TryGuidePage() {
  return (
    <GuidePageShell
      slug="try"
      title="Try it without an account"
      lede="Before you sign in, you can watch a sample chapter on any topic being written, and open each part in the same editor courses use. It takes about a minute. Nothing is kept."
    >
      <GuideSection heading="Make a sample chapter">
        <ol>
          <li>
            Open <Link href="/try">Try it</Link> (also on Alembic&rsquo;s front page:{" "}
            <em>Try it: make a sample chapter</em>). Read the short introduction and
            press <strong>Try it</strong>.
          </li>
          <li>
            Type a <strong>Topic</strong>, for example <em>Photosynthesis</em> or{" "}
            <em>Buffers in blood</em>. Add a <strong>Level</strong> if you like, such as{" "}
            <em>first-year university</em>. Leave <strong>Workshop code</strong> empty
            unless a workshop leader gave you one.
          </li>
          <li>
            Press <strong>Make a sample chapter</strong>. The five parts appear one after
            another, in the order a chapter is built: concept map, assessment guide,
            study guide, slides, practice. Each says <em>Writing…</em> and then{" "}
            <em>Done</em>.
          </li>
          <li>
            Press <strong>Open in the editor</strong> under any part to read it and try
            the editor. You can type in it.
          </li>
        </ol>
        <GuideShot
          src="/guide/try.webp"
          width={1100}
          height={458}
          alt="The Try it page: a yellow note says this is a demo and nothing is saved; a short introduction lists the five parts of a chapter in order; a Try it button."
        />
      </GuideSection>

      <GuideSection heading="What to expect">
        <ul>
          <li>
            The sample is written by a fast, low-cost AI model from its own knowledge
            and Wikipedia; the Wikipedia articles it used are listed at the end. It is a
            demonstration, not checked as a real course is.
          </li>
          <li>
            Nothing is kept. When you leave the page the sample is gone. In the editor,{" "}
            <strong>Save</strong> downloads your own copy to your computer, as a file
            that opens and edits itself in a web browser.
          </li>
          <li>
            The number of samples per day is limited. Past the limit, or when the
            service is resting, you get a ready-made sample chapter instead.
          </li>
          <li>
            The concept map step shows <em>Plan approved (a click in the real
            product)</em>: in your own course, you approve the plan yourself.
          </li>
        </ul>
        <GuideNote>
          <p>
            In your own course today, you write the chapters yourself: the AI helper
            that drafts and revises chapters inside a course is{" "}
            <Link href="/guide/coming-later">coming later</Link>. Try it shows how that
            will feel.
          </p>
        </GuideNote>
      </GuideSection>

      <GuideSection heading="Then">
        <p>
          When the sample is done, the page offers the next steps: the{" "}
          <Link href="/guide/start">Quick start</Link>, a way to{" "}
          <Link href="/contact">write to us</Link>, and{" "}
          <Link href="/signin">Sign in with GitHub</Link> to make your first course.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
