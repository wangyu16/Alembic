import type { SqlClient } from "@alembic/package-ops";

/**
 * Elements shared from course websites for Discover (element-sharing-v3 §5): active shares whose figure or page is
 * among its course's published files, of courses not archived, newest first; a search's text matches titles literally.
 * Nothing is ranked by content (contract §11).
 */
export async function sharedFromSites(sql: SqlClient, q: string | null, limit = 24): Promise<Array<{ id: string; kind: string; title: string; course: string }>> {
  const needle = (q ?? "").trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`);
  const { rows } = await sql.query<{ id: string; kind: string; title: string; course: string }>(
    `select e.id, e.kind, e.title, p.title as course
       from public.shared_elements e
       join public.packages p on p.id = e.package_id and p.archived_at is null
      where e.stopped_at is null
        and exists (select 1 from public.published_files f where f.package_id = e.package_id and f.path = e.path)
        and ($1 = '' or e.title ilike '%' || $1 || '%' or p.title ilike '%' || $1 || '%')
      order by e.shared_at desc limit $2`,
    [needle, limit],
  );
  return rows;
}
