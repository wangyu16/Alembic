import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";

export const metadata = {
  title: "Coming later — Alembic Guide",
  description:
    "What is planned for Alembic but not available yet — the course helper that drafts chapters, bringing in your existing files, adding figures, history and restore, offline use, workshops — and what to do meanwhile.",
};

export default function ComingLaterPage() {
  return (
    <GuidePageShell
      slug="coming-later"
      title="Coming later"
      lede="These are planned but not in Alembic yet. Nothing on this page works today; the rest of the guide describes only what does. If one of them matters to you, write to us: it helps us decide what comes first."
    >
      <GuideSection heading="A course helper that drafts and revises chapters">
        <p>
          An AI helper inside your course that drafts a chapter&rsquo;s parts from your
          concept map and sources, and revises them when you ask, with every change
          waiting for your approval. <Link href="/guide/try">Try it</Link> shows the idea
          on a sample chapter.
        </p>
        <p>
          <strong>Meanwhile:</strong> you write the parts yourself, or paste text you
          already have.
        </p>
      </GuideSection>

      <GuideSection heading="Bringing in your existing files">
        <p>
          Turning the slides, Word documents and PDFs you already have into chapter
          parts.
        </p>
        <p>
          <strong>Meanwhile:</strong> copy the text across by hand, then format it (see{" "}
          <Link href="/guide/formats">Writing formats</Link>). If you have a whole course
          to move, <Link href="/contact">write to us</Link>.
        </p>
      </GuideSection>

      <GuideSection heading="Adding figures from the editor">
        <p>Pasting or dropping your own pictures into a document.</p>
        <p>
          <strong>Meanwhile:</strong> show a picture that is already on the web by its
          address (see <Link href="/guide/writing">Writing and saving</Link>). Figures
          that came with a course we moved into Alembic for you are already in it. If
          you are at home on GitHub, you can add a picture to the{" "}
          <em>assets</em> folder of your course there and show it with{" "}
          <code>![A short description](../assets/picture.png)</code>.
        </p>
      </GuideSection>

      <GuideSection heading="History and restore">
        <p>
          Seeing the earlier versions of a document, and bringing one back, from the
          workspace.
        </p>
        <p>
          <strong>Meanwhile:</strong> every version saved to the course is kept in its
          history in your GitHub account, including both versions when two people
          changed the same place. If you need one back,{" "}
          <Link href="/contact">write to us</Link>.
        </p>
      </GuideSection>

      <GuideSection heading="Changing the shape of a course">
        <p>
          Renaming, moving and removing chapters; changing the licence; writing your
          own private instructor documents; giving the course website a description;
          adding documents beyond the five parts; taking a chapter off the website.
        </p>
        <p>
          <strong>Meanwhile:</strong> add chapters in teaching order and choose the
          licence with care. If you need one of these now,{" "}
          <Link href="/contact">write to us</Link>.
        </p>
      </GuideSection>

      <GuideSection heading="Sending a downloaded file back">
        <p>
          Bringing the changes you made in a downloaded file back into the course in one
          step.
        </p>
        <p>
          <strong>Meanwhile:</strong> copy the changed text into the document in Alembic
          (see <Link href="/guide/download">Download and present</Link>).
        </p>
      </GuideSection>

      <GuideSection heading="An app you install, and working offline">
        <p>
          Alembic as an app on your computer, with your courses at hand without a
          connection.
        </p>
        <p>
          <strong>Meanwhile:</strong> the editor already keeps your typing on your
          computer when the connection drops and sends it when you are back (see{" "}
          <Link href="/guide/writing">Writing and saving</Link>), and a downloaded file
          opens anywhere.
        </p>
      </GuideSection>

      <GuideSection heading="Workshops">
        <p>
          Hands-on sessions where you build part of your own course with us. They are
          planned but not yet scheduled.
        </p>
        <p>
          <strong>Meanwhile:</strong> to hear when they are, <Link href="/contact">write
          to us</Link> and choose <em>Workshops</em> as the topic.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
