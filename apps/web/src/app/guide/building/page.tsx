import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { BlueprintFigure, SpineFigure } from "../guide-figures";

export const metadata = {
  title: "How a course gets built — Alembic Guide",
  description:
    "You decide what to teach and what's ready; AI does the tedious, error-prone work. How AI helps — in the workspace and by building a whole package — and what Alembic guarantees: clean provenance, accessibility, valid formatting, and a consistent course.",
};

export default function BuildingPage() {
  return (
    <GuidePageShell
      slug="building"
      title="How a course gets built"
      lede="You stay on the high ground — deciding what to teach, and what is ready. The slow, error-prone parts of making a document — formatting, attribution, accessibility, keeping a whole course consistent — are exactly what AI does well. Here is how that help works, and what Alembic guarantees so you don't have to check it by hand."
    >
      <GuideSection
        heading="You lead; AI handles the details"
        figure={<BlueprintFigure />}
        figureCaption="You supply the substance and the direction; AI turns it into clean, consistent course materials. Nothing is final until you approve it."
      >
        <p>
          Your part is the <strong>substance</strong>: a concept map of what
          you&rsquo;ll teach and how it connects, an assessment guide for how each
          idea is judged, a raw draft, and the calls that need a teacher&rsquo;s
          judgment. AI&rsquo;s part is the <strong>craft</strong>: consistent
          formatting, real alt text, tightened language, correct notation, and a
          course whose pieces agree with one another.
        </p>
        <p>
          <strong>How much you write depends on the course.</strong>{" "}For
          introductory topics, where good open material already exists, AI can do
          most of the assembly from your outline. For advanced or specialized
          courses, where little public material exists, you supply more of the raw
          content — and AI still turns it into clean, accessible, well-structured
          documents. Either way you decide what to teach and what is ready; AI never
          publishes anything on its own, and <strong>you review before anything is
          final.</strong>
        </p>
      </GuideSection>

      <GuideSection heading="Two ways to get AI's help">
        <p>
          <strong>In the workspace, on one document.</strong>{" "}As you edit a study
          guide or a deck, you can ask the assistant for a focused pass — check
          spelling and grammar, improve the language, check accessibility, tidy the
          formatting, or suggest a slide layout. Each is a <em>scoped</em> edit you
          see and approve, and it never disturbs your citations, links, or
          equations — the stable markers that make a document quotable stay exactly
          as they were.
        </p>
        <p>
          <strong>Or build a whole package with an AI agent.</strong>{" "}When you want
          to draft an entire course from your sources, an AI assistant (in a chat
          tool like Claude, Gemini, or ChatGPT) can drive{" "}
          <strong>Coursewerk</strong> — a guided recipe that walks the assistant
          through assembling a complete package: the concept map, study guides,
          slides, practice, and figures, each checked as it goes. It pauses at every
          major step for your review, and hands you a finished package you{" "}
          <Link href="/guide/offline">upload to Alembic</Link> as a single file.
          Same guarantees below apply either way.
        </p>
      </GuideSection>

      <GuideSection
        heading="What Alembic guarantees"
        figure={<SpineFigure />}
        figureCaption="The study guide is the spine. Change it, and Alembic flags the slides and practice that derive from it — so nothing quietly falls out of step."
      >
        <p>
          These are the tedious checks that are easy to get wrong by hand, so
          Alembic makes them <strong>structural</strong> — not a setting you can
          forget:
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-faint">
          <li>
            <strong>Clean provenance and attribution.</strong>{" "}Every figure has to
            prove a clean origin — you made it, or it&rsquo;s openly licensed with
            its source recorded. The attribution list is <em>compiled</em> from
            those records rather than kept by hand, so it can never drift out of
            date, and nothing without a clear source slips in.
          </li>
          <li>
            <strong>Accessibility, built in.</strong>{" "}Alt text on every figure,
            headings that don&rsquo;t skip levels, and meaning that never rides on
            color alone — checked as the course is built, not bolted on at the end.
          </li>
          <li>
            <strong>A course that stays consistent.</strong>{" "}The study guide is the
            spine; the slides, practice, and concept map derive from it. Change the
            guide and Alembic flags exactly which of them now need another look, so
            an edit never quietly leaves the rest out of step.
          </li>
          <li>
            <strong>Formatting that always renders.</strong>{" "}The rich formatting —
            callouts, columns, tables, equations, chemical structures — is validated
            so a document always displays correctly, with no broken layout waiting to
            surprise a student.
          </li>
        </ul>
        <p>
          None of this asks you to become an accessibility auditor or a copyright
          lawyer. You keep your attention on the teaching; the checks keep the course
          clean.
        </p>
      </GuideSection>

      <GuideSection heading="Free platform, metered AI">
        <p>
          <strong>Alembic itself is free and open to use.</strong>{" "}Organizing,
          previewing, publishing, and sharing cost nothing. The AI assistant is the
          one part that costs something to run, so it works on credits — covered by a
          sponsor or grant, or purchased — which keeps the platform free for
          everyone. You can always do the writing yourself; the assistant is there to
          take the tedious work off your hands, not to stand between you and your
          course.
        </p>
        <p>
          Next, see exactly what a package holds and what each part is for.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
