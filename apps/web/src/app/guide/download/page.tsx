import Link from "next/link";
import { GuideNote, GuidePageShell, GuideSection } from "../_components/guide-page-shell";

export const metadata = {
  title: "Download and present — Alembic Guide",
  description:
    "Download any document as one file that opens and edits itself in a web browser, and present your slides as a slideshow, with the keys that matter in class.",
};

export default function DownloadPage() {
  return (
    <GuidePageShell
      slug="download"
      title="Download and present"
      lede="Any document can leave Alembic as a single file you can open, read and edit in a web browser. Slides can also be shown straight from the editor as a slideshow."
    >
      <GuideSection heading="Download">
        <p>
          Open the document and press <strong>Download</strong> at the top right. You
          get one file: a document ends in <em>.md.html</em>, a slide deck in{" "}
          <em>.slides.html</em>. It holds what is in your editor at that moment, with
          the course&rsquo;s figures inside it.
        </p>
        <p>
          Double-click the file to open it in your web browser. It shows the finished
          document. A small pencil at the bottom left opens its own editor, where you can
          change the text and save the file again.
        </p>
        <GuideNote>
          <p>
            The file opens anywhere, but formulas, chemistry, diagrams and some fonts
            are fetched from the internet when it opens. Open it once while online to
            check them.
          </p>
        </GuideNote>
        <p>
          Changes you make in a downloaded file stay in that file: they don&rsquo;t go
          back to the course by themselves. To bring a change back, copy the text into
          the document in Alembic. Sending a downloaded file back in one step is{" "}
          <Link href="/guide/coming-later">coming later</Link>.
        </p>
      </GuideSection>

      <GuideSection heading="Present your slides">
        <p>
          In a slide deck, press <strong>Present</strong> at the top right. The deck
          opens in a new tab, as a slideshow, exactly as it is in your editor at that
          moment (even words not yet saved to the course).
        </p>
        <ul>
          <li>
            <kbd>→</kbd>, <kbd>Space</kbd> or <kbd>Page Down</kbd>: next.{" "}
            <kbd>←</kbd> or <kbd>Page Up</kbd>: previous.
          </li>
          <li>
            <kbd>F</kbd>: fill the screen. <kbd>Esc</kbd>: leave full screen.
          </li>
          <li>
            <kbd>O</kbd>: see all slides at once; <kbd>Enter</kbd> or <kbd>Esc</kbd>{" "}
            leaves it.
          </li>
          <li>
            <kbd>S</kbd>: the speaker view, in its own window: the current and next
            slide, your notes, a clock and a timer. If your browser blocks the window,
            the page says so.
          </li>
          <li>
            <kbd>?</kbd> lists all the keys.
          </li>
        </ul>
        <p>
          Speaker notes are written in the deck itself: after a line{" "}
          <code>{"<!-- @notes -->"}</code> at the end of a slide (see{" "}
          <Link href="/guide/formats">Writing formats</Link>). Changes made in the
          slideshow tab are not saved to the course: make them in the editor.
        </p>
        <p>
          A very large deck, usually one with big pictures pasted into it, can&rsquo;t be
          presented from the editor; a note says so. Use <strong>Download</strong> and
          open the file: it presents the same way.
        </p>
      </GuideSection>

      <GuideSection heading="In class">
        <ul>
          <li>
            Present from the editor when you have a good connection.
          </li>
          <li>
            As a backup, <strong>Download</strong> the deck before class and open it
            once while online.
          </li>
          <li>
            Once the chapter is published, students find the same slides on the course
            website.
          </li>
        </ul>
      </GuideSection>
    </GuidePageShell>
  );
}
