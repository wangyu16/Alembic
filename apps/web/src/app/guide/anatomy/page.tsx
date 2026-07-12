import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { PackageFigure } from "../guide-figures";

export const metadata = {
  title: "Anatomy of a package — Alembic Guide",
  description:
    "Everything a course package holds and what each part is for: the blueprint you plan (concept map + assessment guide), the course materials assembled from it (study guide, slides, practice), shared assets, and the private side (answer keys, notes, exams).",
};

interface Part {
  name: string;
  role: string;
}

const BLUEPRINT_PARTS: Part[] = [
  {
    name: "Concept map",
    role: "Your plan — the concepts you'll teach, how they connect, and the learning objective for each. Plain text, concise.",
  },
  {
    name: "Assessment guide",
    role: "Your plan for assessment — how each concept should be judged across homework, quizzes, and exams. Instructions, not a question bank.",
  },
];

const COURSE_PARTS: Part[] = [
  {
    name: "Study guide",
    role: "The center of the course materials — the core reading students receive, assembled from the blueprint.",
  },
  {
    name: "Slides",
    role: "A lecture deck per chapter, assembled from the study guide and yours to refine.",
  },
  {
    name: "Practice",
    role: "Worked examples and practice questions students can try on their own.",
  },
  {
    name: "Quizzes & exams",
    role: "Assessments built from the assessment guide. Public where appropriate; exam content and answer keys stay private (below).",
  },
];

const SHARED_PARTS: Part[] = [
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
      lede="A package is your whole course in one place. Here is everything it can hold, and what each part is for — grouped by the lines that matter: the plan you write, the course it produces, and what stays yours."
    >
      <GuideSection
        heading="Two sides, one course"
        figure={<PackageFigure />}
        figureCaption="The public side is the course students receive. The private side, under lock, never reaches them."
      >
        <p>
          Every package has a <strong>public</strong>{" "}side and a{" "}
          <strong>private</strong>{" "}side, kept physically apart. You author both in
          the same workspace; Alembic guarantees that private material can never
          appear on the public side, even by accident. Where a document lives
          decides who can see it.
        </p>
        <p>
          You won&rsquo;t use every part below in every course. A package can be as
          small as one study guide, and grow from there.
        </p>
      </GuideSection>

      <GuideSection heading="The blueprint — what you plan">
        <p>
          Concise, plain-text documents where you set the framework. This is the
          layer you work in most.
        </p>
        <PartList parts={BLUEPRINT_PARTS} />
      </GuideSection>

      <GuideSection heading="The course — what students receive">
        <p>
          The polished, public-facing documents, assembled from the blueprint —
          centered on the study guide.
        </p>
        <PartList parts={COURSE_PARTS} />
      </GuideSection>

      <GuideSection heading="Shared across the course">
        <PartList parts={SHARED_PARTS} />
      </GuideSection>

      <GuideSection heading="The private side — what stays with you">
        <PartList parts={PRIVATE_PARTS} />
        <p className="mt-2">
          When in doubt about whether something is student-facing, keep it private
          — you can always share a piece later, but the separation is there to
          protect you by default.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
