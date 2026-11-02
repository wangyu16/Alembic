/**
 * History and snapshots on the server (history-v3 §1–§5). Reads go through
 * the course's GitHub client; who did what comes only from commits Alembic
 * recorded making.
 */
import { CompareIncompleteError } from "@alembic/github-bridge";
import { historyOf, type HistoryEntry } from "@alembic/package-ops";
import { directDb } from "./db";
import { courseRepo } from "./course-v3";

/** Commits Alembic made in this course (their trailers are trusted). */
export async function ourCommits(packageId: string): Promise<Set<string>> {
  const sql = directDb();
  if (!sql) return new Set();
  const { rows } = await sql.query<{ sha: string }>(
    `select unnest(planned_shas) as sha from public.write_queue where package_id = $1
     union select jsonb_array_elements_text(result->'commits') from public.write_queue where package_id = $1 and jsonb_typeof(result->'commits') = 'array'`,
    [packageId]);
  return new Set(rows.map((r) => r.sha));
}

/** Members' names by id (for "who"). */
async function memberNames(packageId: string): Promise<Map<string, string>> {
  const sql = directDb();
  if (!sql) return new Map();
  const { rows } = await sql.query<{ id: string; name: string | null }>(
    `select p.id, coalesce(nullif(p.display_name, ''), p.github_username) as name from public.course_members m join public.profiles p on p.id = m.user_id where m.package_id = $1`, [packageId]);
  return new Map(rows.filter((r) => r.name).map((r) => [r.id, r.name!]));
}

export interface DocHistory { entries: Array<HistoryEntry & { published: boolean }>; head: string }

/** A document's last 50 versions: one GitHub call; published marks from the database. */
export async function documentHistory(packageId: string, path: string): Promise<DocHistory | null> {
  const c = await courseRepo(packageId);
  if (!c) return null;
  const coords = { owner: c.owner, repo: c.name };
  const [commits, ours, names, head] = await Promise.all([
    c.client.listCommits(coords, { path, perPage: 50, sha: "main" }),
    ourCommits(packageId),
    memberNames(packageId),
    c.repo.head(),
  ]);
  const sql = directDb();
  const published = new Set<string>();
  if (sql) {
    const { rows } = await sql.query<{ commit_sha: string }>(
      `select v.commit_sha from public.doc_versions v join public.published_files f on f.package_id = v.package_id and f.path = v.path and f.version = v.version
        where v.package_id = $1 and v.path = $2`, [packageId, path]);
    for (const r of rows) published.add(r.commit_sha);
  }
  const entries = historyOf(commits, ours, (id) => names.get(id) ?? null).map((e) => ({ ...e, published: published.has(e.sha) }));
  return { entries, head };
}

/**
 * Is `sha` in the course's own history (an ancestor of the head, or the head)? With it, the files changed since
 * (null when too many to list): a restore checks the instructor files added or changed in that range (audit r1 H-1).
 */
export async function inCourseHistory(packageId: string, sha: string, atHead?: string): Promise<{ ok: boolean; changed: Array<{ path: string; status: string }> | null }> {
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, changed: null };
  const c = await courseRepo(packageId);
  if (!c) return { ok: false, changed: null };
  const head = atHead ?? (await c.repo.head()); // the caller's head, so the range and its later reads agree (audit r2 L-c)
  if (head === sha) return { ok: true, changed: [] };
  try {
    return { ok: true, changed: await c.client.compareCommits({ owner: c.owner, repo: c.name }, sha, head) };
  } catch (e) {
    if (e instanceof CompareIncompleteError) return { ok: e.reason === "too-many-files", changed: null }; // an ancestor, just a big change
    return { ok: false, changed: null };
  }
}

export { snapshotSlug } from "./snapshot-slug";
