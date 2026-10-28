/**
 * The write queue's consumer on the worker (A4; queue-and-jobs-v3 §3): find
 * courses with due rows, and drain each one through the course committer
 * against that course's working repo, using the owner's App installation.
 * One holder per course is enforced by the fenced lease in SQL, so several
 * workers can run this safely. Versions the committer writes are recorded in
 * doc_versions (the merge base for the next change).
 */
import { createHash } from "node:crypto";
import { GitHubClient, installationTokenSource, workingRepo } from "@alembic/github-bridge";
import { drainCourse, SqlQueueStore, type QueueRow, type QueueStore, type SqlClient } from "@alembic/package-ops";

export interface CommitterConfig {
  sql: SqlClient;
  appId: string;
  privateKey: string;
  holder: string;               // this worker's name (lease holder)
  log?: (m: string) => void;
}

const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

/** Courses with rows that are due now. */
export async function dueCourses(sql: SqlClient, limit = 20): Promise<string[]> {
  const { rows } = await sql.query<{ package_id: string }>(
    `select package_id from public.write_queue
      where status in ('queued', 'retry', 'processing') and next_attempt_at <= now()
      group by package_id order by min(seq) limit $1`, [limit]);
  return rows.map((r) => r.package_id);
}

export async function drainOne(cfg: CommitterConfig, packageId: string): Promise<number> {
  const { rows } = await cfg.sql.query<{ installation_id: string; private_repo: { owner: string; name: string } | null }>(
    `select i.installation_id, p.private_repo from public.packages p join public.course_installations i on i.package_id = p.id where p.id = $1`, [packageId]);
  const c = rows[0];
  // jsonb may arrive as text, depending on the client and how it was written.
  const raw0: unknown = c?.private_repo;
  const pr = typeof raw0 === "string" ? (JSON.parse(raw0) as unknown) : raw0;
  const working = pr as { owner?: unknown; name?: unknown } | null | undefined;
  if (!working || typeof working.owner !== "string" || typeof working.name !== "string") return 0;
  const coords = { owner: working.owner, repo: working.name };
  const client = new GitHubClient(installationTokenSource({
    appId: cfg.appId, privateKey: cfg.privateKey, installationId: Number(c!.installation_id), repositories: [coords.repo],
  }));
  const repo = workingRepo(client, coords);
  const raw = new SqlQueueStore(cfg.sql);
  const payloads = new Map<string, QueueRow>();
  const store: QueueStore = {
    acquire: raw.acquire.bind(raw),
    roleOf: raw.roleOf.bind(raw),
    claimCurrent: raw.claimCurrent.bind(raw),
    recordPlanned: raw.recordPlanned.bind(raw),
    async next(p, holder, fence) {
      const row = await raw.next(p, holder, fence);
      if (row) payloads.set(row.id, row);
      return row;
    },
    async finish(i) {
      await raw.finish(i);
      // Record what the course now holds for each file this row wrote.
      const head = (i.result as { head?: string } | undefined)?.head;
      const row = payloads.get(i.id);
      if (i.status !== "done" || !head || !row) return;
      for (const f of row.payload.files) {
        if (f.text === null) continue;
        const text = await repo.readFile(head, f.path);
        if (text === null) continue;
        await cfg.sql.query(`insert into public.doc_versions (package_id, path, version, commit_sha) values ($1, $2, $3, $4) on conflict do nothing`,
          [packageId, f.path, sha256(text), head]);
      }
    },
    async baseText(p, path, version) {
      const { rows: v } = await cfg.sql.query<{ commit_sha: string }>(
        `select commit_sha from public.doc_versions where package_id = $1 and path = $2 and version = $3`, [p, path, version]);
      if (!v[0]) return undefined; // unknown base: the version rule treats the change as on top of the head
      const text = await repo.readFile(v[0].commit_sha, path);
      return text !== null && sha256(text) === version ? text : undefined;
    },
  };
  return drainCourse(packageId, cfg.holder, store, repo);
}

/** One pass over every course with due rows; a course's failure never stops the others. */
export async function committerPass(cfg: CommitterConfig): Promise<number> {
  let n = 0;
  for (const p of await dueCourses(cfg.sql)) {
    try {
      n += await drainOne(cfg, p);
    } catch (e) {
      cfg.log?.(`committer ${p}: ${(e as Error).message}`);
    }
  }
  return n;
}
