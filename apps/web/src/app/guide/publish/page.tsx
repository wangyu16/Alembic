import Link from "next/link";
import { GuideNote, GuidePageShell, GuideSection, GuideShot } from "../_components/guide-page-shell";

export const metadata = {
  title: "Publishing and your website — Alembic Guide",
  description:
    "What Publish does, when a chapter is ready, approving the course plan, the checks, what you see while publishing, and your course website.",
};

export default function PublishPage() {
  return (
    <GuidePageShell
      slug="publish"
      title="Publishing and your website"
      lede="Publishing copies the chapters that are ready to your course's public copy and updates its website. Nothing is public until you publish, and only the owner or deputy can do it."
    >
      <GuideSection heading="What Publish does">
        <p>
          Your course itself stays private in your GitHub account. When you press{" "}
          <strong>Publish</strong>, Alembic copies every chapter that is ready to the
          course&rsquo;s <strong>public copy</strong>, also in your GitHub account (the
          first Publish makes it), and updates the <strong>course website</strong>.
        </p>
        <p>
          Chapters that are not ready are left as they were: a chapter published before
          stays on the website as it was then; a chapter never published isn&rsquo;t
          there yet. Its new edits wait for a later Publish. Instructor-only documents
          are never published.
        </p>
      </GuideSection>

      <GuideSection heading="When a chapter is ready">
        <p>All three must be true:</p>
        <ol>
          <li>
            It is <strong>not a draft</strong>: someone pressed{" "}
            <strong>Mark ready</strong>.
          </li>
          <li>
            Its <strong>course plan is approved</strong>: the concept map and assessment
            guide, as they are now.
          </li>
          <li>
            The <strong>checks pass</strong>: nothing in the chapter repeats an answer
            key or copies a source.
          </li>
        </ol>
      </GuideSection>

      <GuideSection heading="The Publish page">
        <p>
          Open it with <strong>Publish</strong> on the course page. At the top: a short
          reminder of the rules above, the website&rsquo;s address once there is one,
          and <strong>The most recent Publish</strong>. Below, a table with one row per
          chapter.
        </p>
        <GuideShot
          src="/guide/publish.webp"
          width={1100}
          height={899}
          alt="The Publish page with the website address, the most recent Publish ('Published Oct 29, 1:01 AM CDT. 19 of 21 chapters are public.'), and a table: one chapter Ready with an Approved course plan; one Draft whose course plan offers 'Approve it as it is now'; one Draft whose course plan is 'Not written yet' with Start it; then the Publish button."
          caption="This picture leaves out most rows of a longer course."
        />
        <ul>
          <li>
            <strong>Chapter</strong>: its title, with <em>edited since the last Publish</em>{" "}
            when its documents changed after the last Publish, or{" "}
            <em>not published yet</em>.
          </li>
          <li>
            <strong>Status</strong>: <em>Draft</em>, <em>Ready</em>, or{" "}
            <em>Ready once the course plan is approved</em>. The owner or deputy sees{" "}
            <strong>Mark ready</strong> or <strong>Back to draft</strong> next to it. A
            change shows <em>(saving…)</em> for a few seconds.
          </li>
          <li>
            <strong>Course plan</strong>: <em>Approved</em>; or <em>Not written yet</em>{" "}
            with <strong>Start it</strong>, which adds the concept map and assessment
            guide; or links to read the <strong>concept map</strong> and{" "}
            <strong>assessment guide</strong>, then{" "}
            <strong>Approve it as it is now</strong>. Co-authors see{" "}
            <em>Waiting for the owner or deputy to approve the course plan</em>.
          </li>
        </ul>
      </GuideSection>

      <GuideSection heading="Approving the course plan">
        <p>
          Read the chapter&rsquo;s concept map and assessment guide, then press{" "}
          <strong>Approve it as it is now</strong>. The page says{" "}
          <em>Course plan approved.</em> Approval is for the text you read: if anyone
          changes either document afterwards, the column asks for approval again, and
          that chapter&rsquo;s new changes are not published until it is given.
        </p>
      </GuideSection>

      <GuideSection heading="Publishing">
        <ol>
          <li>
            Press <strong>Publish</strong> at the bottom of the table. (If a status
            change is still being saved, the button says{" "}
            <em>Waiting for a status change to be saved…</em>; wait a few seconds.)
          </li>
          <li>
            The page says <em>Publishing… this page updates by itself.</em>
          </li>
          <li>
            When it is done, <strong>The most recent Publish</strong> says{" "}
            <em>Published</em>, the time, and how many chapters are public. Any chapter
            that was left as it was is listed with the reason: <em>it is a draft</em>,{" "}
            <em>its course plan isn&rsquo;t approved</em>, or what a check found.
          </li>
          <li>
            Above it, <em>Website: being built…</em> changes to the website&rsquo;s
            address when the site has been updated.
          </li>
        </ol>
        <p>
          Pressing Publish again when nothing has changed is harmless: it says{" "}
          <em>nothing had changed since the last Publish</em>.
        </p>
      </GuideSection>

      <GuideSection heading="When a check finds something">
        <p>
          The checks look for two things: a chapter repeating an answer key, and a
          chapter copying a source. If one finds something, that chapter stays as it was
          and the result says what was found. Fix it and publish again. If you are sure
          the chapter is fine, the owner or deputy can tick <strong>Publish anyway</strong>{" "}
          in that chapter&rsquo;s row and press <strong>Publish</strong>.
        </p>
      </GuideSection>

      <GuideSection heading="Your course website">
        <p>
          The website lives on GitHub&rsquo;s free website service, at an address like{" "}
          <em>https://your-github-name.github.io/your-course-name/</em>. The exact
          address is on the Publish page. Its front page shows the course title and the
          published chapters in order, each with links to its parts; each part is a page
          of its own, and slides play as a slideshow.
        </p>
        <GuideShot
          src="/guide/site.webp"
          width={1100}
          height={672}
          alt="The front page of a published course website: the course title, a description, and a numbered list of chapters with links to each part."
        />
        <GuideNote>
          <p>
            The very first time, GitHub can take a few minutes before the address works.
            If the Publish page says <em>Website: not updated</em>, it lists what went
            wrong; if the reason isn&rsquo;t clear, <Link href="/contact">write to us</Link>.
          </p>
        </GuideNote>
        <p>
          To take a chapter off the website, there is no button yet. <strong>Back to
          draft</strong> stops new changes from going out, but the last published
          version stays.
        </p>
      </GuideSection>

      <GuideSection heading="Who can publish">
        <p>
          The owner and the deputy. Co-authors can open the Publish page and see every
          chapter&rsquo;s state; instead of the button they see{" "}
          <em>Only the owner or deputy publishes.</em>
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
