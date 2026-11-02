import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";

export const metadata = {
  title: "Working together — Alembic Guide",
  description:
    "Owner, deputy and co-author: what each can do. Inviting a co-author, naming a deputy, leaving a course, writing in the same document, and the Needs you page.",
};

const ROLES: Array<{ role: string; can: string; cannot: string }> = [
  {
    role: "Owner",
    can: "Everything: writes every part, adds chapters, marks chapters ready or back to draft, approves course plans, publishes, invites and removes people, names a deputy.",
    cannot: "—",
  },
  {
    role: "Deputy",
    can: "A co-author the owner trusts with more, until a date the owner chooses (at most about six months ahead): writes, adds chapters, marks chapters ready, approves course plans, publishes.",
    cannot: "Invite or remove people, or name a deputy.",
  },
  {
    role: "Co-author",
    can: "Writes every part of every chapter, the course plan included. Sees the Publish page.",
    cannot: "Add chapters, mark chapters ready, approve course plans or publish.",
  },
];

export default function TogetherPage() {
  return (
    <GuidePageShell
      slug="together"
      title="Working together"
      lede="A course can have several people. The owner decides who works on it; everyone writes; the owner, or a deputy, approves and publishes."
    >
      <GuideSection heading="Who can do what">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.95rem]">
            <thead>
              <tr className="border-b border-edge text-ink">
                <th scope="col" className="py-2 pr-4 font-medium">Role</th>
                <th scope="col" className="py-2 pr-4 font-medium">Can</th>
                <th scope="col" className="py-2 font-medium">Can&rsquo;t</th>
              </tr>
            </thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r.role} className="border-b border-edge-soft align-top">
                  <th scope="row" className="py-2 pr-4 font-medium text-ink">{r.role}</th>
                  <td className="py-2 pr-4">{r.can}</td>
                  <td className="py-2">{r.cannot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The person who creates a course is its owner. The line under the course title
          on the course page always says which role you have there.
        </p>
      </GuideSection>

      <GuideSection heading="Inviting a co-author">
        <p>Only the owner invites. On the course page press <strong>People</strong>, then:</p>
        <ol>
          <li>
            Under <strong>Invite a co-author</strong>, type their{" "}
            <strong>GitHub user name</strong> (the short name on their GitHub profile,
            for example <em>octocat</em>).
          </li>
          <li>
            Press <strong>Invite as co-author</strong>. A box shows an invitation link.
            Press <strong>Copy</strong> and send the link to them by email or chat. The
            link is shown only once. Sometimes the box says <em>We emailed it to them
            too.</em>
          </li>
        </ol>
        <p>
          The link works for 14 days. Until it is used, the invitation is listed under{" "}
          <strong>Waiting to be accepted</strong>, where <strong>Cancel</strong>{" "}
          withdraws it.
        </p>
      </GuideSection>

      <GuideSection heading="Accepting an invitation">
        <p>
          Open the link. It says <em>You&rsquo;re invited to work on a course</em>. Sign
          in with the GitHub account the invitation was made for, then press{" "}
          <strong>Join the course</strong>. The course is now in your Workspace. If the
          page says the invitation can&rsquo;t be used, it has expired, been used, been
          cancelled, or was made for another GitHub account: ask the owner for a new one.
        </p>
      </GuideSection>

      <GuideSection heading="Naming a deputy, removing, leaving">
        <ul>
          <li>
            <strong>Make deputy</strong>: on the People page, next to a co-author, choose
            the last day and press <strong>Make deputy</strong>. Useful while you are
            away. <strong>End deputy</strong> stops it early.
          </li>
          <li>
            <strong>Remove</strong>: the owner takes someone off the course.
          </li>
          <li>
            <strong>Leave this course</strong>: a co-author or deputy takes themselves off.
          </li>
        </ul>
      </GuideSection>

      <GuideSection heading="Writing in the same document">
        <p>
          When someone else has the same document open, a blue bar at the top says{" "}
          <em>Also here:</em> with their name. Their saved changes appear in your editor
          with a brief highlight. If you both change the same place, a yellow note says
          both versions are kept. Details are in{" "}
          <Link href="/guide/writing">Writing and saving</Link>.
        </p>
        <p>
          When a co-author changes a concept map or an assessment guide, the owner or
          deputy approves the course plan again before that chapter&rsquo;s changes are
          published.
        </p>
      </GuideSection>

      <GuideSection heading="Needs you">
        <p>
          The <strong>Needs you</strong> page lists things waiting for a person&rsquo;s
          decision, grouped by chapter, and lets you answer or dismiss them there. Items
          only the owner or deputy can decide show{" "}
          <em>Waiting for the course owner.</em> to everyone else. Most of the time it
          says <em>Nothing needs you right now.</em>
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
