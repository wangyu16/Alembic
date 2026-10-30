/**
 * One-time migration to per-file status (family docs/SITE-TYPE-CONTRACT.md §14): every page a course has
 * published so far is marked completed, so the first Publish under the new rule changes nothing on the
 * website; everything else stays draft. Queued as one course operation by the course's owner (the worker
 * applies it, skipping pages deleted since).
 *
 *   DATABASE_URL=… npx tsx apps/web/scripts/mark-published-completed.ts <packageId> [--dry-run]
 */
import postgres from "postgres";
import { isPage } from "@alembic/package-contract";
import { SqlQueueStore, MAX_STATUS_PATHS, type SqlClient } from "@alembic/package-ops";

const [packageId, flag] = process.argv.slice(2);
if (!packageId || !process.env.DATABASE_URL) {
  console.error("usage: DATABASE_URL=… mark-published-completed.ts <packageId> [--dry-run]");
  process.exit(2);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const client: SqlClient = { query: async <T>(text: string, params: unknown[] = []) => ({ rows: (await sql.unsafe(text, params as never[])) as unknown as T[] }) };

try {
  const { rows: files } = await client.query<{ path: string }>(`select path from public.published_files where package_id = $1`, [packageId]);
  const pages = files.map((f) => f.path).filter(isPage).sort();
  const { rows: owners } = await client.query<{ user_id: string }>(`select user_id from public.course_members where package_id = $1 and role = 'owner' limit 1`, [packageId]);
  if (!owners[0]) throw new Error("this course has no owner");
  console.log(`${pages.length} published pages to mark completed${pages.length > MAX_STATUS_PATHS ? ` (in ${Math.ceil(pages.length / MAX_STATUS_PATHS)} operations)` : ""}`);
  if (flag === "--dry-run") { for (const p of pages) console.log(`  ${p}`); }
  else if (pages.length) {
    const store = new SqlQueueStore(client);
    for (let k = 0; k < pages.length; k += MAX_STATUS_PATHS) {
      await store.insert({ packageId, kind: "courseop", idem: `status:migrate:${packageId}:${k}`, actorId: owners[0].user_id,
        payload: { files: [], op: { op: "setStatus", paths: pages.slice(k, k + MAX_STATUS_PATHS), status: "completed" }, summary: "Marked the published pages completed (move to page status)" } });
    }
    console.log("queued; the worker applies it in a few seconds");
  }
} finally {
  await sql.end();
}
