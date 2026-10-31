import Link from "next/link";
import { GuideExample, GuideNote, GuidePageShell, GuideSection } from "../_components/guide-page-shell";

export const metadata = {
  title: "Fast path for experienced users — Alembic Guide",
  description:
    "Already know your course? Create it with all chapters and parts in one step, paste a table of contents into Add chapters, start every part, mark chapters ready and publish.",
};

export default function FastPathPage() {
  return (
    <GuidePageShell
      slug="fast-path"
      title="Fast path for experienced users"
      lede="You know your course and its chapters. Here is the shortest way from a table of contents to a published course website. Everything on this page is explained in detail elsewhere in the guide."
    >
      <GuideSection heading="1 · Create the course with every chapter at once">
        <p>
          On your <Link href="/workspace">Workspace</Link>, in the{" "}
          <strong>New course</strong> box: type the title, choose the licence, paste
          your table of contents into <strong>Chapters, one per line</strong>, tick{" "}
          <strong>Start every chapter&rsquo;s five parts now</strong>, and press{" "}
          <strong>Create course</strong>. About 15 seconds later the course page opens
          with every chapter and all its parts.
        </p>
        <GuideExample label="Paste one chapter title per line. No numbers needed: the course numbers them in this order.">
          {"Matter and Measurement\nAtoms, Molecules, and Ions\nStoichiometry\nReactions in Aqueous Solutions\nGases"}
        </GuideExample>
        <GuideNote>
          <p>
            Up to 30 chapters go in at a time. For a longer course, put the first 30
            here and the rest in <strong>Add chapters</strong> (next step). Your first
            course asks you to connect GitHub first; see step 3 of the{" "}
            <Link href="/guide/start">Quick start</Link>.
          </p>
        </GuideNote>
      </GuideSection>

      <GuideSection heading="2 · Add chapters to a course you already have">
        <p>
          On the course page, open <strong>Add chapters</strong>, paste the titles one
          per line, keep <strong>Also start each chapter&rsquo;s five parts</strong>{" "}
          ticked, and press <strong>Add</strong>. The chapters are added at the end, as
          drafts, and appear after a few seconds (up to a minute when the course is busy). Only the course&rsquo;s owner or deputy
          sees this box.
        </p>
      </GuideSection>

      <GuideSection heading="3 · Start any missing parts">
        <p>
          A chapter with parts not yet started shows them under{" "}
          <strong>Not started</strong>. Press <strong>Start all</strong> to start them
          together, or one <strong>Start …</strong> button for a single part.
        </p>
      </GuideSection>

      <GuideSection heading="4 · Write, or paste what you have">
        <p>
          Open each part from the course page and write, or paste text you already
          have. Text written in Markdown keeps its formatting; see{" "}
          <Link href="/guide/formats">Writing formats</Link>. Your words are saved to
          the course 30 seconds after you stop typing, or at once with{" "}
          <kbd>Ctrl</kbd>+<kbd>S</kbd> (<kbd>⌘</kbd>+<kbd>S</kbd>).{" "}
          <kbd>Ctrl</kbd>+<kbd>\</kbd> (<kbd>⌘</kbd>+<kbd>\</kbd>) switches between
          Editor, Split and Preview.
        </p>
        <p>
          Keep the few lines between <code>{"{{nyml"}</code> and <code>{"}}"}</code>{" "}
          at the top of each document: they are its settings. You may change its{" "}
          <code>title:</code>.
        </p>
      </GuideSection>

      <GuideSection heading="5 · Mark ready, approve, Publish">
        <p>
          Open <strong>Publish</strong>. For each chapter you want public: press{" "}
          <strong>Mark ready</strong>, read its concept map and assessment guide, and
          press <strong>Approve it as it is now</strong>. Then press{" "}
          <strong>Publish</strong> once for the whole course. Chapters still in draft
          are left out; they join a later Publish.
        </p>
      </GuideSection>

      <GuideSection heading="6 · Share the website">
        <p>
          When the Publish is done, the Publish page shows the course website&rsquo;s
          address. Give it to your students. To update the website later, edit and
          press <strong>Publish</strong> again; chapters changed since the last time
          are marked <em>edited since the last Publish</em>.
        </p>
      </GuideSection>

      <GuideSection heading="Worth knowing">
        <ul>
          <li>
            Changing a concept map or an assessment guide after approving it means
            approving it again before that chapter&rsquo;s changes are published.
          </li>
          <li>
            Co-authors can write everything in the chapters; only the owner or deputy
            adds chapters, marks them ready, approves and publishes. See{" "}
            <Link href="/guide/together">Working together</Link>.
          </li>
          <li>
            Chapters can&rsquo;t yet be renamed, moved or removed in the workspace, so
            check your list before you paste it. See{" "}
            <Link href="/guide/coming-later">Coming later</Link>.
          </li>
        </ul>
      </GuideSection>
    </GuidePageShell>
  );
}
