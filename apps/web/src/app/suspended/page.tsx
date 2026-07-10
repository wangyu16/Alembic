import Link from "next/link";

export const metadata = {
  title: "Account suspended · Alembic",
};

/**
 * Where a suspended educator lands. Middleware signs any live session out and
 * sends it here (docs/specs/user-governance.md §4). Deliberately plain and
 * calm — no developer or enforcement jargon (CLAUDE.md): it explains the state
 * and offers a way to get in touch, nothing more. The specific reason lives in
 * the admin's records and is shared through that contact route rather than
 * exposed on this page.
 */
export default function SuspendedPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="panel flex flex-col gap-4 p-8">
        <h1 className="font-serif text-3xl tracking-tight text-ink">
          Your account is suspended
        </h1>
        <p className="leading-relaxed text-muted">
          Access to Alembic has been paused for this account, so you can&rsquo;t
          sign in or open your workspace right now. Your published courses live
          in your own connected repositories and are unaffected.
        </p>
        <p className="leading-relaxed text-muted">
          If you think this is a mistake or you&rsquo;d like to understand why,
          please reach out to the site owner who administers this Alembic
          instance. They can review the account and, if appropriate, restore it.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Link href="/" className="btn btn-ghost">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
