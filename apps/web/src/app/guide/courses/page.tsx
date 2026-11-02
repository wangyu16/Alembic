import Link from "next/link";
import { GuideNote, GuidePageShell, GuideSection } from "../_components/guide-page-shell";

export const metadata = {
  title: "Courses and chapters — Alembic Guide",
  description:
    "What a course holds, how to create one, the five parts of every chapter, draft chapters, adding chapters, and everything on the course page.",
};

const PARTS: Array<{ name: string; what: string }> = [
  { name: "Concept map", what: "The chapter's key ideas and how they connect: its scope, a summary, what students need first, the objectives section by section, and where students usually get stuck. Part of the course plan." },
  { name: "Study guide", what: "The main reading for students, with formulas, tables and diagrams." },
  { name: "Slides", what: "A deck to teach the chapter in class." },
  { name: "Assessment guide", what: "What students should be able to do, and how questions check it, objective by objective. Part of the course plan." },
  { name: "Practice", what: "Questions with worked answers." },
];

export default function CoursesPage() {
  return (
    <GuidePageShell
      slug="courses"
      title="Courses and chapters"
      lede="A course is a title, a licence, and chapters in order. Every chapter has the same five parts. This page covers creating a course, adding chapters, and everything you find on the course page."
    >
      <GuideSection heading="Where your course is kept">
        <p>
          Your course is kept in <strong>your own GitHub account</strong>, privately.
          You will see it in your list of projects on GitHub, with a name ending in{" "}
          <em>-private</em>. Only you can see it on GitHub; the people you invite work on
          it through Alembic.
        </p>
        <p>
          When you publish, Alembic makes a <strong>public copy</strong> of the ready
          chapters, also in your GitHub account, and builds the{" "}
          <strong>course website</strong> from it. The public copy and the website are
          open to everyone. See <Link href="/guide/publish">Publishing and your website</Link>.
        </p>
      </GuideSection>

      <GuideSection heading="Creating a course">
        <p>
          On your <Link href="/workspace">Workspace</Link>, the <strong>New course</strong>{" "}
          box asks for:
        </p>
        <ul>
          <li>
            <strong>Course title.</strong> It becomes the title of your website.
          </li>
          <li>
            <strong>Licence.</strong> How others may reuse your work.{" "}
            <em>CC BY 4.0</em> (chosen for you): anyone may reuse it with credit.{" "}
            <em>CC BY-SA 4.0</em>: with credit, and they share theirs the same way.{" "}
            <em>CC BY-NC 4.0</em>: with credit, not for profit.{" "}
            <em>CC BY-NC-SA 4.0</em>: both of those. <em>CC0 1.0</em>: no conditions at
            all. <em>Private (all rights reserved)</em>: no reuse without asking you.
            Choose with care: the licence can&rsquo;t yet be changed from the workspace.
          </li>
          <li>
            <strong>Chapters, one per line</strong> (optional). Up to 30. Leave it
            empty and the course starts with one chapter called <em>Introduction</em>.
          </li>
          <li>
            <strong>Start every chapter&rsquo;s five parts now</strong>. Ticked: every
            chapter starts with all five parts. Not ticked: each chapter starts with its
            study guide only, and you start the others when you want them.
          </li>
        </ul>
        <p>
          Press <strong>Create course</strong>. It takes about 15 seconds; then the
          course page opens. Your first course asks you to connect GitHub first (see
          step 3 of the <Link href="/guide/start">Quick start</Link>).
        </p>
        <p>
          To come back to a course later, open your Workspace and press{" "}
          <strong>Open course</strong> next to its title.
        </p>
      </GuideSection>

      <GuideSection heading="The five parts of a chapter">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.95rem]">
            <thead>
              <tr className="border-b border-edge text-ink">
                <th scope="col" className="py-2 pr-4 font-medium">Part</th>
                <th scope="col" className="py-2 font-medium">What it is for</th>
              </tr>
            </thead>
            <tbody>
              {PARTS.map((p) => (
                <tr key={p.name} className="border-b border-edge-soft align-top">
                  <th scope="row" className="py-2 pr-4 font-medium whitespace-nowrap text-ink">{p.name}</th>
                  <td className="py-2">{p.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The <strong>concept map</strong> and the <strong>assessment guide</strong>{" "}
          together are the chapter&rsquo;s <strong>course plan</strong>. The owner (or
          deputy) approves the plan before the chapter is published, and again after
          the plan changes.
        </p>
        <p>
          Each part starts with a few headings or an example to show its shape: the
          concept map and assessment guide with their sections, the slides with a title
          slide, practice with one question and its answer. Keep the headings; replace
          the rest.
        </p>
        <GuideNote>
          <p>
            All five parts appear on your public website once the chapter is published,
            the assessment guide included. Don&rsquo;t put anything students must not
            see, such as answer keys for graded tests, in a chapter&rsquo;s parts.
          </p>
        </GuideNote>
      </GuideSection>

      <GuideSection heading="Draft and ready chapters">
        <p>
          Every new chapter starts as a <strong>draft</strong>, shown by a grey{" "}
          <strong>Draft</strong> label on the course page. Drafts are not published.
          When a chapter is ready for students, the owner or deputy presses{" "}
          <strong>Mark ready</strong> on the Publish page. <strong>Back to draft</strong>{" "}
          there turns it back: the website then keeps the chapter as it was last
          published, and new edits wait.
        </p>
      </GuideSection>

      <GuideSection heading="The course page">
        <p>From top to bottom:</p>
        <ul>
          <li>
            <strong>← Your courses</strong> goes back to your Workspace.
          </li>
          <li>
            The course title, and one line saying what you can do in this course: as
            owner, deputy or co-author (see <Link href="/guide/together">Working together</Link>).
          </li>
          <li>
            <strong>Needs you</strong>, <strong>People</strong> and{" "}
            <strong>Publish</strong>: the other course pages.
          </li>
          <li>
            The chapters, numbered in order. Under each, its parts; click one to open it
            in the editor. Parts not yet started are listed after{" "}
            <strong>Not started</strong>, each with a <strong>Start</strong> button, and{" "}
            <strong>Start all</strong> when more than one is missing.
          </li>
          <li>
            <strong>Add chapters</strong> (owner and deputy only).
          </li>
          <li>
            <strong>Course-wide files</strong>: documents that belong to the whole
            course rather than one chapter, such as the <em>Course map</em>.
          </li>
          <li>
            <strong>Instructor only</strong>: documents that are never published and
            never appear on the website. You can read what is there; writing your own
            private instructor documents in the workspace is{" "}
            <Link href="/guide/coming-later">coming later</Link>.
          </li>
        </ul>
        <p>
          When you add chapters or start parts, a note at the top says they appear in a
          few seconds, and the page refreshes by itself until they do.
        </p>
      </GuideSection>

      <GuideSection heading="Adding chapters">
        <p>
          Open <strong>Add chapters</strong> on the course page. Type or paste chapter
          titles, one per line; a whole table of contents is fine, up to 30 at a time.
          Keep <strong>Also start each chapter&rsquo;s five parts</strong> ticked to
          start all their parts too. Press <strong>Add</strong>. The chapters are added
          at the end of the course, as drafts.
        </p>
        <p>
          Add chapters in the order you teach them: chapters can&rsquo;t yet be moved,
          renamed or removed in the workspace (see{" "}
          <Link href="/guide/coming-later">Coming later</Link>). If you need that now,{" "}
          <Link href="/contact">write to us</Link>.
        </p>
      </GuideSection>

      <GuideSection heading="If GitHub is busy">
        <p>
          Sometimes a page says{" "}
          <em>
            GitHub is limiting how often Alembic may read this course right now; nothing
            was changed.
          </em>{" "}
          Nothing is lost. Wait a few minutes and try again.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
