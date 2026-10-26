import Link from "next/link";

/**
 * The site-wide 404. Most visitors who reach it are signed out (a mistyped
 * course or file address), so it offers Home and Discover rather than the
 * workspace, and speaks of pages and courses (blind-critique 2026-10-26).
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-16 text-center">
      <h1 className="font-serif text-2xl tracking-tight text-ink">Not found</h1>
      <p className="text-muted">
        We couldn’t find that page or course. The address may be mistyped, or it
        may no longer be shared.
      </p>
      <div className="flex justify-center gap-3">
        <Link href="/" className="btn btn-primary">
          Home
        </Link>
        <Link href="/portal" className="btn btn-ghost">
          Discover
        </Link>
      </div>
    </main>
  );
}
