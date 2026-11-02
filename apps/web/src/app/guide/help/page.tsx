import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";

export const metadata = {
  title: "Help and contact — Alembic Guide",
  description:
    "How to reach the people who run Alembic, what to include when something isn't working, workshops, and answers to common questions.",
};

const FAQ: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "Where is my course kept, and who can see it?",
    a: (
      <>
        In your own GitHub account, privately. You see it there; your co-authors work on
        it through Alembic. Only what you publish becomes public: the public copy and
        the course website. See <Link href="/guide/courses">Courses and chapters</Link>.
      </>
    ),
  },
  {
    q: "Do I need a GitHub account?",
    a: (
      <>
        Yes, to make a course: you sign in with it, and your course lives in it. To look
        around first, <Link href="/try">Try it</Link> needs no account.
      </>
    ),
  },
  {
    q: "I closed the window before it said “Saved to the course”. Is my work lost?",
    a: (
      <>
        No. It is kept on that computer. Open the same document again on the same
        computer and browser, and Alembic sends it. See{" "}
        <Link href="/guide/writing">Writing and saving</Link>.
      </>
    ),
  },
  {
    q: "My chapter isn’t on the website.",
    a: (
      <>
        Open the Publish page. The chapter must be marked ready, its course plan
        approved, and the checks passed; <em>The most recent Publish</em> says which of
        these held it back. Then press Publish again. See{" "}
        <Link href="/guide/publish">Publishing and your website</Link>.
      </>
    ),
  },
  {
    q: "My co-author can’t publish.",
    a: (
      <>
        Only the owner or a deputy publishes. The owner can make a co-author a deputy
        until a chosen date. See <Link href="/guide/together">Working together</Link>.
      </>
    ),
  },
  {
    q: "A page says GitHub is limiting how often Alembic may read this course.",
    a: <>Nothing was changed and nothing is lost. Wait a few minutes and try again.</>,
  },
  {
    q: "Can the AI write my chapters?",
    a: (
      <>
        Not yet inside your course; that is <Link href="/guide/coming-later">coming later</Link>.{" "}
        <Link href="/try">Try it</Link> shows how it will work on a sample chapter.
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <GuidePageShell
      slug="help"
      title="Help and contact"
      lede="Questions, something that isn't working, or interest in a workshop: write to us. The people who run Alembic read every message and reply by email."
    >
      <GuideSection heading="Write to us">
        <p>
          Use the <Link href="/contact">contact form</Link>. Give your name and email,
          choose what it is about (<em>Using Alembic</em>,{" "}
          <em>Something isn&rsquo;t working</em>, <em>Workshops</em>,{" "}
          <em>Using Alembic at my institution</em> or <em>Something else</em>), write
          your message, and press <strong>Send message</strong>. You see{" "}
          <em>Thank you, your message is on its way.</em> We reply to the email address
          you gave. You don&rsquo;t need to be signed in.
        </p>
        <p>
          An automated assistant reads each message first, only to sort it and summarise
          it in one line for us; it doesn&rsquo;t reply or act on what you write. People
          read and answer every message.
        </p>
        <p>
          <Link href="/contact">Write to us →</Link>
        </p>
      </GuideSection>

      <GuideSection heading="When something isn’t working">
        <p>It helps us most if you include:</p>
        <ul>
          <li>the course name, and which chapter and part;</li>
          <li>what you pressed, and what you expected;</li>
          <li>the exact words of any message on the page (copy them, or take a picture of the screen).</li>
        </ul>
      </GuideSection>

      <GuideSection heading="Workshops">
        <p>
          Workshops are planned but not yet scheduled. To hear about them,{" "}
          <Link href="/contact">write to us</Link> and choose <em>Workshops</em>.
        </p>
      </GuideSection>

      <GuideSection heading="Common questions">
        <dl className="flex flex-col gap-5">
          {FAQ.map((f) => (
            <div key={f.q} className="flex flex-col gap-1">
              <dt className="font-medium text-ink">{f.q}</dt>
              <dd>{f.a}</dd>
            </div>
          ))}
        </dl>
      </GuideSection>
    </GuidePageShell>
  );
}
