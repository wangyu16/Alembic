import Link from "next/link";
import { guideNeighbours } from "../guide-nav";

/** Previous / next page links at the foot of a guide article. */
export function GuideFooterNav({ slug }: { slug: string }) {
  const { prev, next } = guideNeighbours(slug);
  return (
    <nav
      aria-label="More in the guide"
      className="mt-14 flex flex-col gap-3 border-t border-edge pt-6 sm:flex-row sm:items-stretch sm:justify-between"
    >
      {prev ? (
        <Link
          href={prev.href}
          className="group flex flex-1 flex-col gap-0.5 rounded-lg border border-edge p-3 transition-colors hover:border-[var(--accent)] hover:bg-elevated"
        >
          <span className="text-xs text-faint">← Previous</span>
          <span className="font-serif text-ink group-hover:text-[var(--accent)]">{prev.title}</span>
        </Link>
      ) : (
        <span className="hidden flex-1 sm:block" />
      )}
      {next ? (
        <Link
          href={next.href}
          className="group flex flex-1 flex-col gap-0.5 rounded-lg border border-edge p-3 text-right transition-colors hover:border-[var(--accent)] hover:bg-elevated"
        >
          <span className="text-xs text-faint">Next →</span>
          <span className="font-serif text-ink group-hover:text-[var(--accent)]">{next.title}</span>
        </Link>
      ) : (
        <Link
          href="/guide"
          className="group flex flex-1 flex-col gap-0.5 rounded-lg border border-edge p-3 text-right transition-colors hover:border-[var(--accent)] hover:bg-elevated"
        >
          <span className="text-xs text-faint">Next →</span>
          <span className="font-serif text-ink group-hover:text-[var(--accent)]">Back to the guide</span>
        </Link>
      )}
    </nav>
  );
}
