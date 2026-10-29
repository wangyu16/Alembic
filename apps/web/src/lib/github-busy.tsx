/**
 * When GitHub limits how fast Alembic may read a course (RC.12): a calm page
 * instead of "Something went wrong", with the time it resumes when known.
 * Only rate limits are turned into this; every other error (and Next's
 * redirects) passes through.
 */
import Link from "next/link";
import { GitHubError } from "@alembic/github-bridge";

/** The rate limit an error stands for, or null when it isn't one. */
export function githubBusy(e: unknown): { until: Date | null } | null {
  return e instanceof GitHubError && e.rateLimited ? { until: e.retryAt } : null;
}

export function GithubBusy({ until, back }: { until: Date | null; back: string }) {
  const at = until ? until.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : null;
  return (
    <main className="mx-auto max-w-xl p-6" data-testid="github-busy">
      <h1 className="text-xl font-semibold">This course is busy for a moment</h1>
      <p className="mt-2">
        GitHub, where the course is kept, is limiting how often Alembic may read it right now.
        Your work is safe. {at ? <>Please try again after {at}.</> : <>Please try again in a few minutes.</>}
      </p>
      <p className="mt-4"><Link className="underline" href={back}>Back</Link></p>
    </main>
  );
}
