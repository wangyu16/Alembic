import Link from "next/link";
import { GuideNote, GuidePageShell, GuideSection, GuideShot } from "../_components/guide-page-shell";

export const metadata = {
  title: "Quick start: your first hour — Alembic Guide",
  description:
    "Your first hour with Alembic, step by step: sign in, create a course, write a study guide and slides for one class session, and publish your course website.",
};

export default function StartPage() {
  return (
    <GuidePageShell
      slug="start"
      title="Quick start: your first hour"
      lede="In one hour you can have a course with a chapter, a study guide and a few slides for one class session, and a public course website to share with students. Each step below says what to do and what you will see."
    >
      <GuideSection heading="Before you begin">
        <p>
          You need a <strong>GitHub</strong> account. It is free; you can make one at{" "}
          <a href="https://github.com/signup">github.com</a>. Alembic keeps your course
          there, privately, in your own account. Only what you choose to publish
          becomes public.
        </p>
        <p>
          Already know your course and want to set it all up at once? Take the{" "}
          <Link href="/guide/fast-path">fast path</Link> instead.
        </p>
      </GuideSection>

      <GuideSection heading="1 · Look around first (optional, 5 minutes)">
        <p>
          Open <Link href="/try">Try it</Link>. No account is needed. Name any topic and
          a sample chapter is written while you watch: a concept map, an assessment
          guide, a study guide, slides and practice questions. You can open each one
          in the same editor you will use for your course. Nothing is kept. More on{" "}
          <Link href="/guide/try">Try it without an account</Link>.
        </p>
        <GuideShot
          src="/guide/try.webp"
          width={1100}
          height={458}
          alt="The Try it page: a yellow note says this is a demo and nothing is saved; below, the five parts of a chapter are listed in order, and a Try it button."
        />
      </GuideSection>

      <GuideSection heading="2 · Sign in">
        <p>
          Press <strong>Sign in</strong> at the top right, then{" "}
          <strong>Continue with GitHub</strong>. The first time, GitHub asks whether
          Alembic may know who you are; agree. You arrive at your{" "}
          <strong>Workspace</strong>.
        </p>
      </GuideSection>

      <GuideSection heading="3 · Create your course">
        <p>
          In the <strong>New course</strong> box on your Workspace:
        </p>
        <ol>
          <li>Type the course title, for example <em>General Chemistry I</em>.</li>
          <li>
            Choose a licence. <strong>CC BY 4.0</strong> is chosen for you: anyone may
            reuse your work if they credit you. (The choices are explained in{" "}
            <Link href="/guide/courses">Courses and chapters</Link>.)
          </li>
          <li>
            Under <strong>Chapters, one per line</strong>, type one or two chapter
            titles, each on its own line.
          </li>
          <li>
            Tick <strong>Start every chapter&rsquo;s five parts now</strong>.
          </li>
          <li>
            Press <strong>Create course</strong>. The button says{" "}
            <em>Creating… (about 15 seconds)</em>, then your new course page opens.
          </li>
        </ol>
        <GuideShot
          src="/guide/new-course.webp"
          width={1100}
          height={522}
          alt="The New course box: a Course title field, a licence menu set to CC BY 4.0, a box for chapter titles one per line, a tick box to start every chapter's five parts now, and the Create course button."
        />
        <GuideNote>
          <p>
            <strong>Your very first course only:</strong> instead of the course page you
            see <em>Connect GitHub first, then create the course again.</em> Press{" "}
            <strong>Connect GitHub</strong>. GitHub shows a page for installing the
            Alembic app: choose your own account and press <strong>Install</strong>. If
            GitHub asks which of your projects Alembic may use, choose{" "}
            <strong>All repositories</strong>, so Alembic can reach each new course it
            makes for you. You come back to your Workspace, which says GitHub is
            connected. Type the title and chapters
            again and press <strong>Create course</strong>.
          </p>
        </GuideNote>
      </GuideSection>

      <GuideSection heading="4 · Find your way around the course page">
        <p>
          The course page lists your chapters in order. Each new chapter has a grey{" "}
          <strong>Draft</strong> label: drafts are not on your website yet. Under each
          chapter are its five parts: <strong>Concept map</strong>,{" "}
          <strong>Study guide</strong>, <strong>Slides</strong>,{" "}
          <strong>Assessment guide</strong> and <strong>Practice</strong>. Click a part
          to open it.
        </p>
        <p>
          Below the title, one line says what you can do in this course (as its owner,
          everything). The links <strong>Needs you</strong>, <strong>People</strong>{" "}
          and <strong>Publish</strong> lead to the other course pages.
        </p>
        <GuideShot
          src="/guide/course.webp"
          width={1100}
          height={1232}
          alt="A course page: the course title, a line saying what you can do, links Needs you, People and Publish, then numbered chapters each with links to Concept map, Study guide, Slides, Assessment guide and Practice. One chapter has a Draft label and a line 'Not started' with Start buttons. Below: an open Add chapters box, then Course-wide files and Instructor only."
          caption="A course page. A chapter with parts not yet started shows them under “Not started”, with a Start button for each and “Start all”."
        />
        <p>
          If you did not tick the box in step 3, each chapter has only its study guide.
          Press <strong>Start all 4</strong> beside <em>Not started</em> to add the
          other parts. Changes like this appear after a few seconds (up to a minute when the course is busy); the page refreshes
          by itself.
        </p>
      </GuideSection>

      <GuideSection heading="5 · Sketch the course plan (10 minutes)">
        <p>
          Open the chapter&rsquo;s <strong>Concept map</strong>. It already has
          headings to fill in: <em>Source and Scope</em>, <em>Chapter Summary</em>,{" "}
          <em>Prerequisites and Later Payoff</em>, the section-by-section objectives,
          and <em>Common Student Bottlenecks</em>. A few lines under each is plenty for
          now. Then do the same in the <strong>Assessment guide</strong>: what every
          question should check, and one or two question ideas per objective.
        </p>
        <p>
          Together, these two documents are the chapter&rsquo;s{" "}
          <strong>course plan</strong>. Before a chapter is published, its owner
          approves the plan (step 9).
        </p>
      </GuideSection>

      <GuideSection heading="6 · Write the study guide (20 minutes)">
        <p>
          Press <strong>← Course</strong> and open the <strong>Study guide</strong>.
          The editor shows your text on the left and how students will see it on the
          right. Replace <em>Start writing here.</em> with the reading for one class
          session.
        </p>
        <GuideShot
          src="/guide/doc-study.webp"
          width={1100}
          height={513}
          alt="A study guide open in the editor: Editor, Split and Preview buttons, Theme and Width, a Save button, the text on the left and the finished page on the right. At the top right: 'Saved to the course' and Download."
        />
        <p>
          Watch the line at the top right. While you type it says{" "}
          <em>Kept on this device — not in the course yet</em>. About 30 seconds after
          you stop typing it says <em>Saving to the course…</em>, then{" "}
          <em>Saved to the course at 10:42</em> (your time). Press{" "}
          <strong>Save</strong> (or <kbd>Ctrl</kbd>+<kbd>S</kbd>, <kbd>⌘</kbd>+
          <kbd>S</kbd> on a Mac) to save at once.
        </p>
        <p>
          Formulas go between dollar signs, <code>$E = mc^2$</code>, and chemistry
          like this: <code>{"$\\ce{2H2 + O2 -> 2H2O}$"}</code>. See{" "}
          <Link href="/guide/formats">Writing formats</Link> for tables, boxes,
          questions and more.
        </p>
      </GuideSection>

      <GuideSection heading="7 · Make a few slides and present them (10 minutes)">
        <p>
          Go back to the course and open <strong>Slides</strong>. Each slide begins
          with a line <code>{"<!-- slide -->"}</code>. Change the title slide, then
          add two or three slides of your own: a line <code>{"<!-- slide -->"}</code>,
          a heading starting with <code>##</code>, and a few points starting with{" "}
          <code>-</code>.
        </p>
        <GuideShot
          src="/guide/doc-slides.webp"
          width={1100}
          height={513}
          alt="A slide deck open in the editor: the text with slide lines on the left, the slides on the right with a small card showing 'Slide 1 of 29, fits'. At the top right: 'Saved to the course', Present and Download."
        />
        <p>
          Press <strong>Present</strong> at the top right. Your slides open in a new
          tab as a slideshow. The arrow keys move between slides, <kbd>F</kbd> fills
          the screen, and <kbd>Esc</kbd> leaves full screen. Close the tab when you
          are done. More in <Link href="/guide/download">Download and present</Link>.
        </p>
      </GuideSection>

      <GuideSection heading="8 · Invite a co-author (optional)">
        <p>
          As the course&rsquo;s owner, on the course page press <strong>People</strong>. Under{" "}
          <strong>Invite a co-author</strong>, type your colleague&rsquo;s GitHub user
          name and press <strong>Invite as co-author</strong>. A link appears; press{" "}
          <strong>Copy</strong> and send it to them. It is shown only once and works for
          14 days. See <Link href="/guide/together">Working together</Link>.
        </p>
      </GuideSection>

      <GuideSection heading="9 · Mark the chapter ready and approve its plan">
        <p>
          On the course page press <strong>Publish</strong>. The table lists every
          chapter.
        </p>
        <ol>
          <li>
            In the <strong>Status</strong> column your chapter says <em>Draft</em>. Press{" "}
            <strong>Mark ready</strong>. A note says{" "}
            <em>Saved; it takes a few seconds to show.</em>
          </li>
          <li>
            In the <strong>Course plan</strong> column, open the{" "}
            <strong>concept map</strong> and <strong>assessment guide</strong> links and
            read them through. Then press <strong>Approve it as it is now</strong>. A
            note says <em>Course plan approved.</em> and the column says{" "}
            <em>Approved</em>.
          </li>
        </ol>
        <GuideShot
          src="/guide/publish.webp"
          width={1100}
          height={899}
          alt="The Publish page: a short explanation of when a chapter is ready, the course website address, the most recent Publish, and a table of chapters with Status (Ready or Draft, with Mark ready or Back to draft) and Course plan (Approved, Approve it as it is now, or Not written yet with Start it), and the Publish button."
        />
      </GuideSection>

      <GuideNote>
        <p>
          <strong>Before you mark a chapter ready:</strong> a part you started but never
          changed is published as it is, starter text and all (&ldquo;Write the question
          here.&rdquo;). Fill in or remove what you don&rsquo;t want students to see.
        </p>
      </GuideNote>

      <GuideSection heading="10 · Publish">
        <p>
          Press <strong>Publish</strong>. The page says{" "}
          <em>Publishing… this page updates by itself.</em> When it is done you see{" "}
          <em>Published</em>, the time, and how many chapters are public. Above it,{" "}
          <em>Website: being built…</em> turns into your website&rsquo;s address after a
          short wait.
        </p>
      </GuideSection>

      <GuideSection heading="11 · Open your course website">
        <p>
          Click the address. The front page shows your course title and your published
          chapters in order, each with links to its parts. This is the address to give
          your students.
        </p>
        <GuideShot
          src="/guide/site.webp"
          width={1100}
          height={672}
          alt="A published course website: the course title, a short description, and a numbered list of chapters, each followed by links to Concept map, Study guide, Slides, Assessment guide and Practice."
        />
        <GuideNote>
          <p>
            The very first time, GitHub can take a few minutes before the address
            shows your site. If it shows an error page, wait and try again.
          </p>
        </GuideNote>
      </GuideSection>

      <GuideSection heading="Where next">
        <ul>
          <li>
            <Link href="/guide/writing">Writing and saving</Link>: exactly when your
            words reach the course, and what happens when you are offline.
          </li>
          <li>
            <Link href="/guide/formats">Writing formats</Link>: math, chemistry, tables,
            boxes, questions and slides, with examples.
          </li>
          <li>
            <Link href="/guide/publish">Publishing and your website</Link>: what the
            checks look for, and how to update the site.
          </li>
          <li>
            Stuck? <Link href="/contact">Write to us</Link>.
          </li>
        </ul>
      </GuideSection>
    </GuidePageShell>
  );
}
