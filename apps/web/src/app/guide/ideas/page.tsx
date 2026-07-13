import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import {
  PackageFigure,
  BlueprintFigure,
  SelfContainedFigure,
} from "../guide-figures";

export const metadata = {
  title: "Core ideas — Alembic Guide",
  description:
    "The three ideas Alembic is built on: you get versioning and publishing without ever touching Git, you lead while AI handles the tedious details, and every document is a self-contained file that carries its own editor.",
};

export default function CoreIdeasPage() {
  return (
    <GuidePageShell
      slug="ideas"
      title="Core ideas"
      lede="Alembic turns your teaching materials into open, reusable resources — and does the technical work quietly, so you stay focused on the knowledge. Three ideas make the rest of the guide obvious."
    >
      <GuideSection
        heading="Versioning and publishing, without Git"
        figure={<PackageFigure />}
        figureCaption="One package, two halves: a public side for students and a private side, under lock, for answer keys and notes."
      >
        <p>
          Your course lives in a <strong>package</strong> — one course&rsquo;s study
          guides, slides, practice, figures, and instructor materials, with two
          halves: a <strong>public</strong> side for everything students see, and a
          <strong> private</strong> side for answer keys, exams, and your own notes.
          That separation is <strong>physical</strong>, not a setting you can forget
          to switch: private material simply cannot cross into the public side.
        </p>
        <p>
          Behind the scenes this is professional version control — the same
          machinery software teams use to track history and never lose work. But you
          never see any of it. You <strong>save</strong>, <strong>preview</strong>,{" "}
          <strong>publish</strong>, take a named <strong>snapshot</strong> each term
          (&ldquo;Fall&nbsp;2026&rdquo;), <strong>restore</strong> exactly what you
          taught, <strong>cite</strong> a fixed version, <strong>adapt</strong>{" "}
          someone else&rsquo;s work, and <strong>share</strong> — never a branch, a
          commit, or a merge.
        </p>
        <p>
          When you publish, Alembic moves your course out of its temporary storage
          and into <strong>your own space on GitHub</strong> — the account you signed
          in with — where it&rsquo;s served as a website. It&rsquo;s yours, and it
          keeps working with or without Alembic; Alembic is only the bridge.
        </p>
      </GuideSection>

      <GuideSection
        heading="You lead; AI handles the details"
        figure={<BlueprintFigure />}
        figureCaption="You write a concise blueprint; AI assembles it into polished, consistent course materials, centered on the study guide."
      >
        <p>
          You work at the top, on a short, plain-text <strong>blueprint</strong> — a
          concept map of what you&rsquo;ll teach and how it connects, and an
          assessment guide for how each concept is judged. From that plan the{" "}
          <strong>course materials</strong> — study guide, slides, practice, quizzes,
          exams — are assembled, with the study guide at their center.
        </p>
        <p>
          The <strong>tedious part</strong> of making a document — consistent
          formatting, accessibility, spelling and grammar, tightening language,
          keeping every piece of the course in agreement — is exactly what AI does
          well, and Alembic <strong>guarantees</strong> the parts that are easy to
          get wrong. Your part is the substance: the direction, the raw draft, and
          the details that matter. Alembic itself is free and open; only the AI
          assistant is metered.{" "}
          <Link href="/guide/building">
            How a course gets built, and what&rsquo;s guaranteed &rarr;
          </Link>
        </p>
      </GuideSection>

      <GuideSection
        heading="Documents carry their own editor"
        figure={<SelfContainedFigure />}
        figureCaption="A self-contained file opens in any browser to read — and the editor travels inside it."
      >
        <p>
          Alembic&rsquo;s documents are <strong>self-contained files</strong>: a
          page, a slide deck, or a print document, each one a single file that opens
          in any browser to read, present, or print — with an editor built into the
          file itself. Under every document is a{" "}
          <strong>markdown source of truth</strong>: edit it in the Alembic
          workspace, or download the file and edit it locally — either way it stays
          the same document, editable forever with nothing to install.
        </p>
        <p>
          Because the editor travels with the file, your students can keep their own
          copies too — annotate, highlight, and add worked examples offline, in a
          copy that is entirely theirs and never touches your original. And copying
          from a rendered page copies the <em>markdown source</em> — not just the
          text but the rich formatting, tables, equations, and chemical structures —
          ready to paste straight into another Alembic document or any markdown
          editor. These formats come from the{" "}
          <a href="https://markdown.orz.how" target="_blank" rel="noreferrer">
            orz-markdown family
          </a>
          .
        </p>
      </GuideSection>

      <GuideSection heading="A note on sharing">
        <p>
          You don&rsquo;t need a finished course to contribute. A single clear
          illustration, a well-worked derivation, a clean explanation of one stubborn
          concept — small pieces like these are exactly what other educators search
          for. Anything on <Link href="/portal">Discover</Link> can be adapted: take
          a resource, make it fit your students, and attribution travels
          automatically. If you improve something you adapted, you can suggest the
          change back — the original author reviews it in plain language and accepts
          with one click.
        </p>
        <p>
          Next, see how a course actually gets built — and what Alembic guarantees so
          you don&rsquo;t have to check it by hand.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
