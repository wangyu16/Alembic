import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import {
  PackageFigure,
  SpineFigure,
  SelfContainedFigure,
  PublishFigure,
} from "../guide-figures";

export const metadata = {
  title: "Core ideas — Alembic Guide",
  description:
    "The five ideas Alembic is built on: your course is a package, the study guide is the spine, documents carry their own editor, you own everything, and sharing starts small.",
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
          A <strong>package</strong> holds one course — its study guides, slides,
          practice questions, figures, and instructor materials. It has two
          halves: a <strong>public</strong> side for everything students see, and
          a <strong>private</strong> side for answer keys, exams, and your own
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
        heading="The study guide is the spine"
        figure={<SpineFigure />}
        figureCaption="Slides, practice, and the concept map derive from the study guide and stay traceable to it."
      >
        <p>
          Each chapter centers on one <strong>study guide</strong> — a concise
          companion when you teach from a textbook, or textbook-grade detail when
          you don&rsquo;t. It is the organizing source of truth. Slides and
          practice questions derive from it and stay linked back, so when the
          study guide changes, Alembic flags what has drifted and you decide:
          regenerate, merge, or keep your version.
        </p>
        <p>
          You are never locked in. An edit you make directly to the slides is
          legitimate — Alembic records it as your own change, not an error.
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
          into the file itself. Download a study guide and it stays editable
          forever, with nothing to install.
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
          point. Take a named <strong>snapshot</strong> each term
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
