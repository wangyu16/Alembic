import Link from "next/link";
import { directDb } from "@/lib/db";
import { sharedFromSites } from "@/lib/shared-from-sites";

/**
 * Elements shared from course websites (element-sharing-v3 §5, step 2): active shares whose figure or page is on its
 * course's website now, newest first. Nothing is ranked by content (contract §11); a search's text filters titles.
 */
export async function SharedFromSites({ q }: { q: string | null }) {
  const sql = directDb();
  if (!sql) return null;
  const rows = await sharedFromSites(sql, q).catch(() => []);
  if (!rows.length) return null;
  return (
    <section aria-label="Shared from course websites" data-testid="shared-from-sites">
      <h2 className="text-sm font-medium text-muted">Shared from course websites</h2>
      <ul className="mt-2 divide-y divide-[var(--edge-soft)]">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline gap-3 py-2">
            <span className="badge">{r.kind === "figure" ? "Figure" : "Section"}</span>
            <Link prefetch={false} className="link min-w-0 flex-1 truncate" href={`/e/${r.id}`}>{r.title}</Link>
            <span className="truncate text-xs text-muted">{r.course}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
