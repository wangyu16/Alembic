import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import {
  PackageFigure,
  BlueprintFigure,
  SelfContainedFigure,
  PublishFigure,
} from "../guide-figures";

export const metadata = {
  title: "Core ideas — Alembic Guide",
  description:
    "The five ideas Alembic is built on: your course is a package, you plan a blueprint that AI assembles into the course, documents carry their own editor, you own everything, and sharing starts small.",
};

export default function CoreIdeasPage() {
  return (
    <GuidePageShell
      slug="ideas"
      title="Core ideas"
      lede="Alembic turns your teaching materials into open, reusable resources — and does the technical work quietly, so you stay focused on the knowledge. Five ideas make the rest of the guide obvious."
    >
      <GuideSection
        heading="Your course lives in a package"
        figure={<PackageFigure />}
        figureCaption="One package, two halves: a public side for students and a private side, under lock, for answer keys and notes."
      >
        <p>
          A <strong>package</strong>{" "}holds one course — its study guides, slides,
          practice questions, figures, and instructor materials. It has two
          halves: a <strong>public</strong>{" "}side for everything students see, and
          a <strong>private</strong>{" "}side for answer keys, exams, and your own
          notes.
        </p>
        <p>
          That separation is <strong>physical</strong>, not a setting you can
          forget to switch: private material simply cannot cross into the public
          side. You never have to think about repositories or version control —
          you save, preview, publish, snapshot, adapt, cite, and share.
        </p>
      </GuideSection>

      <GuideSection
        heading="You plan; AI does the editing"
        figure={<BlueprintFigure />}
        figureCaption="You write a concise blueprint; AI assembles it into polished course materials, centered on the study guide."
      >
        <p>
          A course is built in two layers. You work at the top, on a short,
          plain-text <strong>blueprint</strong>{" "}— a concept map of what you&rsquo;ll
          teach and how it connects, and an assessment guide for how each concept is
          judged. From that plan, the <strong>course materials</strong>{" "}— study
          guide, slides, practice, quizzes, exams — are assembled, with the study
          guide at their center.
        </p>
        <p>
          The <strong>tedious part</strong>{" "}of making a document — consistent
          formatting, accessibility, spelling and grammar, tightening and
          re-organizing language — is exactly what AI does well. It follows agent
          skills, so the result is correct and consistent, far cleaner than
          hand-editing. Your part is the substance: a raw draft, the direction,
          and the details that matter.
        </p>
        <p>
          <strong>How much you write depends on the course.</strong>{" "}For
          introductory topics, where good open material already exists, AI can do
          most of the work from your outline. For advanced or specialized courses,
          where little public material exists, you supply more of the raw content
          — and AI still turns it into clean, accessible, well-structured
          documents. Either way, you stay on the high ground: deciding what to
          teach and what is ready.
        </p>
      </GuideSection>

      <GuideSection
        heading="Documents carry their own editor"
        figure={<SelfContainedFigure />}
        figureCaption="A self-contained file opens in any browser to read — and the editor travels inside it."
      >
        <p>
          Alembic&rsquo;s documents are <strong>self-contained files</strong>:
          a page, a slide deck, or a print document, each one a single file that
          opens in any browser to read, present, or print — with an editor built
          into the file itself. Under every document is a{" "}
          <strong>markdown source of truth</strong>: edit it in the Alembic
          workspace, or download the file and edit it locally — either way it
          stays the same document, editable forever with nothing to install.
        </p>
        <p>
          Because the editor travels with the file, your students can keep their
          own copies too — annotate, highlight, and add worked examples offline,
          in a copy that is entirely theirs and never touches your original.
          These formats come from the{" "}
          <a href="https://markdown.orz.how" target="_blank" rel="noreferrer">
            orz-markdown family
          </a>
          .
        </p>
      </GuideSection>

      <GuideSection
        heading="You own it — and it&rsquo;s yours to keep"
        figure={<PublishFigure />}
        figureCaption="Publishing builds a course website hosted under your own account; everything works without Alembic."
      >
        <p>
          When you publish, Alembic builds a course website hosted under your
          own account. Everything remains usable without Alembic — that is the
          point. Take a named <strong>snapshot</strong>{" "}each term
          (&ldquo;Fall&nbsp;2026&rdquo;) to cite, compare, and restore exactly
          what you taught.
        </p>
      </GuideSection>

      <GuideSection heading="Sharing starts small">
        <p>
          You don&rsquo;t need a finished course to contribute. A single clear
          illustration, a well-worked derivation, a clean explanation of one
          stubborn concept — small pieces like these are exactly what other
          educators search for. Anything on{" "}
          <Link href="/portal">Discover</Link>{" "}can be adapted: take a resource,
          make it fit your students, and attribution travels automatically. If
          you improve something you adapted, you can suggest the change back —
          the original author reviews it in plain language and accepts with one
          click.
        </p>
        <p>
          Next, see exactly what a package holds and what each part is for.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
