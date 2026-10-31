import Link from "next/link";
import { GuidePageShell, GuideSection, GuideShot } from "../_components/guide-page-shell";

export const metadata = {
  title: "Writing and saving — Alembic Guide",
  description:
    "The document editor and its three views, the line that tells you where your words are, when they are saved to the course, and what happens offline or when two people change the same place.",
};

const STATUS: Array<{ says: string; means: string }> = [
  { says: "Kept on this device — not in the course yet", means: "You are typing. Every change is already kept on this computer; it goes to the course shortly." },
  { says: "Saving to the course…", means: "Your text is on its way." },
  { says: "Saved to the course at 10:42", means: "The course has your text, as of that time. Everyone else who opens the document sees it." },
  { says: "Kept on this device — will save to the course when back online", means: "The connection dropped. Keep working; Alembic tries again every 30 seconds." },
  { says: "Kept on this device only — couldn't save to the course: …", means: "The course refused the change, for the reason given (for example, a file only the owner or deputy may change). Your text stays on this computer; nothing is lost." },
];

export default function WritingPage() {
  return (
    <GuidePageShell
      slug="writing"
      title="Writing and saving"
      lede="Every part of a chapter opens in the same editor. You type; Alembic keeps every change on your computer at once and saves it to the course shortly after. This page explains the editor, and exactly when your words reach the course."
    >
      <GuideSection heading="Opening a document">
        <p>
          On the course page, click a part under a chapter, for example{" "}
          <strong>Study guide</strong>. The top bar shows <strong>← Course</strong>{" "}
          (back to the course page) and the document&rsquo;s title. On the right are the
          saving line and <strong>Download</strong>; slides also have{" "}
          <strong>Present</strong>.
        </p>
        <GuideShot
          src="/guide/doc-study.webp"
          width={1100}
          height={513}
          alt="A study guide open in the editor, in Split view: the text on the left and the finished page on the right. Toolbar: Editor, Split, Preview, Theme, Width, a Saved dot, Sync scroll and Save. Above it: 'Saved to the course' and Download."
        />
      </GuideSection>

      <GuideSection heading="The three views">
        <ul>
          <li>
            <strong>Editor</strong>: only your text, at full width.
          </li>
          <li>
            <strong>Split</strong>: your text on the left, the finished page on the
            right. <strong>Sync scroll</strong> keeps the two sides together as you move.
          </li>
          <li>
            <strong>Preview</strong>: only the finished page, as students will see it.
          </li>
        </ul>
        <p>
          <kbd>Ctrl</kbd>+<kbd>\</kbd> (<kbd>⌘</kbd>+<kbd>\</kbd> on a Mac) switches
          between them. <strong>Theme</strong> and <strong>Width</strong> change how
          this document looks. Slides have their own settings in the same place:{" "}
          <strong>Theme</strong>, <strong>Ratio</strong>,{" "}
          <strong>Slide numbers</strong>, <strong>Progress bar</strong>,{" "}
          <strong>Section numbers</strong>, and <strong>Issues</strong>, which lists
          problems found in the deck, such as a slide with too much on it.
        </p>
        <p>
          The few lines at the very top, from <code>{"{{nyml"}</code> to{" "}
          <code>{"}}"}</code>, are the document&rsquo;s settings: its title, and for
          slides the theme and shape. Change the <code>title:</code> if you like; leave
          the other lines as they are. What to write below them is on{" "}
          <Link href="/guide/formats">Writing formats</Link>.
        </p>
      </GuideSection>

      <GuideSection heading="Where your words are: the saving line">
        <p>The line at the top right always says where your latest words are.</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.95rem]">
            <thead>
              <tr className="border-b border-edge text-ink">
                <th scope="col" className="py-2 pr-4 font-medium">It says</th>
                <th scope="col" className="py-2 font-medium">What it means</th>
              </tr>
            </thead>
            <tbody>
              {STATUS.map((s) => (
                <tr key={s.says} className="border-b border-edge-soft align-top">
                  <td className="py-2 pr-4 italic text-ink">{s.says}</td>
                  <td className="py-2">{s.means}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The editor&rsquo;s own bar shows a small <strong>Saved</strong> dot only once
          the course has your text, and <strong>Unsaved changes</strong> until then.
        </p>
      </GuideSection>

      <GuideSection heading="When your words are saved to the course">
        <ul>
          <li>30 seconds after you stop typing.</li>
          <li>
            At most 2 minutes after you start, if you keep typing without a pause.
          </li>
          <li>
            At once when you press <strong>Save</strong> or <kbd>Ctrl</kbd>+
            <kbd>S</kbd> (<kbd>⌘</kbd>+<kbd>S</kbd>).
          </li>
          <li>
            At once when you leave the document: going back to the course, switching to
            another tab, or closing the window.
          </li>
        </ul>
        <p>
          If you try to close the tab before your words are in the course, the browser
          asks whether you really want to leave. Choose to stay, wait for{" "}
          <em>Saved to the course</em>, then close.
        </p>
      </GuideSection>

      <GuideSection heading="Nothing you type is lost">
        <p>
          Every change is kept on your computer the moment you make it. If the
          connection drops, or you close the window before your words reach the course,
          they wait on this computer. The next time you open the same document,{" "}
          <strong>on the same computer and in the same browser</strong>, Alembic shows
          your words and sends them to the course.
        </p>
      </GuideSection>

      <GuideSection heading="When someone else changes the document">
        <p>
          If a co-author has the same document open, a blue bar says{" "}
          <em>Also here:</em> and their name. When they save, their changes appear in
          your editor with a brief highlight; your cursor and your own unsaved typing
          stay where they are.
        </p>
        <p>
          If you both changed the same place, a yellow note says so:{" "}
          <em>
            Someone else also changed the part you are editing. When your text is saved to the course, both
            versions are kept.
          </em>{" "}
          Alembic never throws either away. One version is what the document shows;
          the other is kept in the course&rsquo;s history. Seeing and restoring earlier
          versions from the workspace is <Link href="/guide/coming-later">coming later</Link>;
          if you need one back now, <Link href="/contact">write to us</Link>.
        </p>
        <p>
          In a study guide, each section that starts with a <code>##</code> heading
          counts as its own place: two people writing in different sections at the same
          time never get in each other&rsquo;s way. In the other parts, the whole
          document is one place, so agree who is writing which part.
        </p>
      </GuideSection>

      <GuideSection heading="Pictures">
        <p>
          A picture already on the web can be shown by its address:{" "}
          <code>![A short description](https://…/picture.png)</code>. Always write the
          description; it is read aloud to students who can&rsquo;t see the picture.
          Adding your own pictures from the editor is not possible yet; see{" "}
          <Link href="/guide/coming-later">Coming later</Link> for what to do meanwhile.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
