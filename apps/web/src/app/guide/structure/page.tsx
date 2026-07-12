import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { BlueprintFigure, SpineFigure, CollectionsFigure } from "../guide-figures";

export const metadata = {
  title: "Documents & collections — Alembic Guide",
  description:
    "How a course is built in two layers: the plain-text blueprint you plan (concept maps + assessment guides), and the course materials assembled from it — centered on the study guide. Plus the three collections.",
};

const COLLECTIONS = [
  {
    name: "Assets",
    role: "Reusable figures, chemical structures, plots, data, and media. Insert an asset into any document, and cite it from anywhere — it lives in one place and is shared across the course.",
  },
  {
    name: "Current",
    role: "This term's teaching cycle: announcements and assignments for the class you're running now. Roll over to a new term and last term's materials are kept, read-only, for reference.",
  },
  {
    name: "Private",
    role: "Instructor-only materials — answer keys, teaching notes, exam content. Everything here stays on the private side and never reaches students.",
  },
];

export default function StructurePage() {
  return (
    <GuidePageShell
      slug="structure"
      title="Documents & collections"
      lede="A course is built in two layers: the blueprint you plan, and the course materials assembled from it. Reusable and time-bound files live in three collections. Once you see the shape, you always know where a thing belongs."
    >
      <GuideSection
        heading="Two layers: the blueprint and the course"
        figure={<BlueprintFigure />}
        figureCaption="You plan a concise blueprint; AI assembles it into the polished course materials, centered on the study guide."
      >
        <p>
          You work at the top. The <strong>blueprint</strong>{" "}is your plan — short,
          plain text, quick to change. The <strong>course</strong>{" "}is the set of
          polished documents students receive, <strong>assembled from the
          blueprint</strong>, largely by AI. You decide what to teach and how to
          assess it; the careful editing work is handled for you.
        </p>
      </GuideSection>

      <GuideSection heading="The blueprint — what you plan">
        <p>
          The blueprint is where the thinking lives. It stays concise and
          plain-text on purpose, so it&rsquo;s easy to write and easy to maintain:
        </p>
        <ul className="ml-4 flex list-disc flex-col gap-2 marker:text-[var(--accent)]">
          <li>
            The <strong>concept map</strong>{" "}— the concepts you&rsquo;ll teach,
            how they connect, and the learning objectives for each.
          </li>
          <li>
            The <strong>assessment guide</strong>{" "}— how each concept should be
            assessed across homework, quizzes, and exams (instructions, not a
            question bank).
          </li>
        </ul>
        <p>
          Together they are the framework of the course. Change the blueprint and
          everything downstream can be brought back in line with it — the
          coherence check compares your finished materials against this intent.
        </p>
      </GuideSection>

      <GuideSection
        heading="The course — assembled from the blueprint"
        figure={<SpineFigure />}
        figureCaption="The study guide is the center of the course materials; slides, practice, quizzes, and exams organize around it and stay traceable."
      >
        <p>
          The course materials are the finished, public-facing documents:{" "}
          <strong>the study guide, slides, practice, quizzes, and exams</strong>{" "}—
          with real structure, layout, and visual design. The{" "}
          <strong>study guide is the center</strong>; the others organize around it
          and stay linked to it, so when it changes, Alembic flags what has drifted.
        </p>
        <p>
          The heavy editing — accuracy, accessibility, copyright, structure,
          format, and layout — is done by <strong>AI agents following agent
          skills</strong>, which makes the result far cleaner than editing each
          document by hand.{" "}
          <a href="https://github.com/wangyu16/coursewerk" target="_blank" rel="noreferrer">
            coursewerk
          </a>{" "}
          is the pipeline that guides an agent to assemble a whole course package
          from your blueprint, ready to upload.
        </p>
        <p>
          Whoever does the editing, <strong>every file keeps a markdown source of
          truth</strong>{" "}— you can edit it in the Alembic workspace, or download it
          and edit it locally.
        </p>
      </GuideSection>

      <GuideSection
        heading="Collections: where the rest lives"
        figure={<CollectionsFigure />}
        figureCaption="Assets are reusable and shared; Current is this term; Private is yours alone."
      >
        <p>
          Alongside the documents, three <strong>collections</strong>{" "}hold
          everything else — each with a clear job:
        </p>
        <dl className="flex flex-col divide-y divide-[var(--edge-soft)]">
          {COLLECTIONS.map((c) => (
            <div key={c.name} className="grid gap-1 py-3 sm:grid-cols-[8rem_1fr] sm:gap-4">
              <dt className="font-serif text-ink">{c.name}</dt>
              <dd className="text-[0.95rem] leading-relaxed text-muted">{c.role}</dd>
            </div>
          ))}
        </dl>
      </GuideSection>
    </GuidePageShell>
  );
}
