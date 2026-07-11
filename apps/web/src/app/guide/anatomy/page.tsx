import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { PackageFigure } from "../guide-figures";

export const metadata = {
  title: "Anatomy of a package — Alembic Guide",
  description:
    "Everything a course package holds and what each part is for: the public side (study guides, slides, practice, assets, this term) and the private side (answer keys, notes, exams).",
};

interface Part {
  name: string;
  role: string;
}

const PUBLIC_PARTS: Part[] = [
  {
    name: "Study guide",
    role: "The spine of each chapter — the core reading everything else derives from.",
  },
  {
    name: "Slides",
    role: "A lecture deck per chapter, generated from the study guide and yours to refine.",
  },
  {
    name: "Practice",
    role: "Worked examples and practice questions students can try on their own.",
  },
  {
    name: "Concept map",
    role: "The chapter's concepts and learning objectives — a planning layer that guides generation and coherence checks.",
  },
  {
    name: "Assessment guide",
    role: "How each concept should be assessed across homework, quizzes, and exams — instructions, not a question bank.",
  },
  {
    name: "Assets",
    role: "Reusable figures, chemical structures, plots, and media you insert into documents.",
  },
  {
    name: "This term",
    role: "Announcements and assignments for the class you are teaching right now, kept apart from the timeless materials.",
  },
  {
    name: "Course info",
    role: "The package's title, description, license, and instructor details.",
  },
];

const PRIVATE_PARTS: Part[] = [
  {
    name: "Answer keys",
    role: "Full solutions to practice sets and assignments — never shown on the public side.",
  },
  {
    name: "Instructor notes",
    role: "Teaching tips, pacing, and private planning that stays with you.",
  },
  {
    name: "Exam content",
    role: "Assessment material students shouldn't see before it's used.",
  },
];

function PartList({ parts }: { parts: Part[] }) {
  return (
    <dl className="flex flex-col divide-y divide-[var(--edge-soft)]">
      {parts.map((part) => (
        <div key={part.name} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
          <dt className="font-serif text-ink">{part.name}</dt>
          <dd className="text-[0.95rem] leading-relaxed text-muted">{part.role}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AnatomyPage() {
  return (
    <GuidePageShell
      slug="anatomy"
      title="Anatomy of a package"
      lede="A package is your whole course in one place. Here is everything it can hold, and what each part is for — grouped by the one line that matters: what students see, and what stays yours."
    >
      <GuideSection
        heading="Two sides, one course"
        figure={<PackageFigure />}
        figureCaption="The public side is the course students receive. The private side, under lock, never reaches them."
      >
        <p>
          Every package has a <strong>public</strong> side and a{" "}
          <strong>private</strong>{" "}side, kept physically apart. You author both
          in the same workspace; Alembic guarantees that private material can
          never appear on the public side, even by accident. You don&rsquo;t
          have to remember to hide anything — where a document lives decides who
          can see it.
        </p>
        <p>
          You won&rsquo;t use every part below in every course. A package can be
          as small as one study guide, and grow from there.
        </p>
      </GuideSection>

      <GuideSection heading="The public side — what students receive">
        <PartList parts={PUBLIC_PARTS} />
      </GuideSection>

      <GuideSection heading="The private side — what stays with you">
        <PartList parts={PRIVATE_PARTS} />
        <p className="mt-2">
          When in doubt about whether something is student-facing, keep it
          private — you can always share a piece later, but the separation is
          there to protect you by default.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
