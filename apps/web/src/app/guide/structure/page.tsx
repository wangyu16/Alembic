import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { SpineFigure, CollectionsFigure } from "../guide-figures";

export const metadata = {
  title: "Documents & collections — Alembic Guide",
  description:
    "How a package is organized: the study-guide spine and the documents that derive from it, plus the three collections — Assets, Current, and Private.",
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
      lede="A package organizes itself around one idea — the study guide — and keeps reusable and time-bound material in three tidy collections. Once you see the shape, you always know where a thing belongs."
    >
      <GuideSection
        heading="Documents: a spine and what derives from it"
        figure={<SpineFigure />}
        figureCaption="The study guide is the spine; slides, practice, and planning documents derive from it and stay traceable."
      >
        <p>
          The <strong>study guide</strong> is the spine of each chapter — the
          authoritative content. Two kinds of document sit around it:
        </p>
        <ul className="ml-4 flex list-disc flex-col gap-2 marker:text-[var(--accent)]">
          <li>
            <strong>Deliverables</strong>{" "}— the things students receive:{" "}
            <strong>slides</strong>{" "}for lecture and <strong>practice</strong> for
            study. They derive from the study guide and stay linked to it, so
            when it changes, Alembic tells you what has drifted.
          </li>
          <li>
            <strong>Planning documents</strong>{" "}— the{" "}
            <strong>concept map</strong>{" "}(concepts and objectives) and the{" "}
            <strong>assessment guide</strong>{" "}(how to assess each concept). These
            shape what gets generated and let the coherence check compare your
            content against your intent. They can stay public without cluttering
            the student site.
          </li>
        </ul>
        <p>
          Every document is a self-contained file that opens and edits in the
          browser — see <a href="/guide/ideas">Core ideas</a>.
        </p>
      </GuideSection>

      <GuideSection
        heading="Collections: where the rest lives"
        figure={<CollectionsFigure />}
        figureCaption="Assets are reusable and shared; Current is this term; Private is yours alone."
      >
        <p>
          Alongside the documents, three <strong>collections</strong> hold
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
