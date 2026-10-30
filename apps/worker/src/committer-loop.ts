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
import { drainCourse, itemsForLandedChange, SqlQueueStore, type FileOutcome, type QueueRow, type QueueStore, type RemovedChapter, type SqlClient } from "@alembic/package-ops";
import { fileKind, unitPartForPath, WorkingManifestV3Schema } from "@alembic/package-contract";

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

/** An object's methods (own prototype chain, not Object's), bound to it: a wrapper that can't forget one. */
export function bindAll<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (let p = Object.getPrototypeOf(o); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const k of Object.getOwnPropertyNames(p)) {
      const v = (o as Record<string, unknown>)[k];
      if (k !== "constructor" && typeof v === "function" && !(k in out)) out[k] = (v as (...a: unknown[]) => unknown).bind(o);
    }
  }
  return out as T;
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
  // Every method of the SQL store passes through (blobKnown went missing once: uploads were all refused live);
  // only next, finish and baseText are wrapped below.
  const store: QueueStore = {
    ...(bindAll(raw) as unknown as QueueStore),
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
      // A file that landed holds exactly the text sent (version rule: write = incoming), so it needn't be
      // read back from GitHub; combined or kept versions are read (RC.19: GitHub budget per sync).
      const outcomeOf = new Map(((i.result as { files?: Array<{ path: string; outcome: string }> } | undefined)?.files ?? []).map((x) => [x.path, x.outcome]));
      for (const f of row.payload.files) {
        if (f.text === null) continue;
        const text = outcomeOf.get(f.path) === "landed" ? f.text : await repo.readFile(head, f.path);
        if (text === null) continue;
        await cfg.sql.query(`insert into public.doc_versions (package_id, path, version, commit_sha) values ($1, $2, $3, $4) on conflict do nothing`,
          [packageId, f.path, sha256(text), head]);
      }
      await raiseBothChanged(cfg, packageId, row, i.result, repo).catch((e) => console.error("[committer] raising items failed", (e as Error).message));
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

/**
 * Needs-you items for a landed change (write-path §5, contract v3 §13.4): one
 * per file where two changes met; for typing that arrived in a removed
 * chapter, an item for its author and a Restore offer for the owner and deputy.
 */
async function raiseBothChanged(cfg: CommitterConfig, packageId: string, row: QueueRow, result: unknown, repo: { readFile(ref: string, path: string): Promise<string | null>; treeAt?(ref: string): Promise<Map<string, { sha: string; mode: string }>> }): Promise<void> {
  const res = (result ?? {}) as { files?: FileOutcome[]; commits?: string[]; head?: string; base?: string };
  const both = (res.files ?? []).filter((f) => f.outcome === "both-changed");
  if (!both.length || !res.head) return;
  const removed = new Map<string, RemovedChapter>();
  const deletes = both.filter((f) => f.reason === "edit-vs-delete" && unitPartForPath(f.path));
  if (deletes.length) {
    const slugs = (text: string | null) => { try { return WorkingManifestV3Schema.parse(JSON.parse(text ?? "null")).chapters; } catch { return []; } };
    const listed = new Set(slugs(await repo.readFile(res.head, "alembic.json")).map((c) => c.slug));
    for (const f of deletes) {
      const slug = unitPartForPath(f.path)!.slug;
      if (listed.has(slug)) continue;
      const { rows } = await cfg.sql.query<{ base: string | null }>(
        `select result->>'base' as base from public.write_queue where package_id = $1 and kind = 'courseop' and status = 'done'
           and payload->'op'->>'op' = 'removeChapter' and payload->'op'->>'slug' = $2 order by finished_at desc nulls last limit 1`, [packageId, slug]);
      const base = rows[0]?.base;
      if (!base) continue;
      const title = slugs(await repo.readFile(base, "alembic.json")).find((c) => c.slug === slug)?.title ?? slug;
      removed.set(f.path, { slug, title, fromCommit: base });
    }
  }
  const { rows: who } = await cfg.sql.query<{ user_id: string }>(
    `select user_id from public.course_members where package_id = $1 and public.course_role_of($1, user_id) in ('owner', 'deputy')` /* a deputy is a co-author with deputy_until: ask the role function */, [packageId]);
  // The version on top now, per path (text: sha256; figure: blob id).
  const tops = new Map<string, string | null>();
  let tree: Map<string, { sha: string; mode: string }> | null = null;
  for (const f of both) {
    if (fileKind(f.path) === "text") { const t = await repo.readFile(res.head, f.path); tops.set(f.path, t === null ? null : sha256(t)); }
    else { tree ??= repo.treeAt ? await repo.treeAt(res.head) : new Map(); tops.set(f.path, tree.get(f.path)?.sha ?? null); }
  }
  const items = itemsForLandedChange({ tops, rowId: row.id, actorId: row.actorId ?? null, files: both, commits: res.commits ?? [], removed, deciders: who.map((w) => w.user_id), base: res.base ?? null });
  for (const it of items) {
    await cfg.sql.query(`select public.needs_you_raise($1, 'both-changed', 'platform', $2, $3::text::jsonb, $4, $5, false, $6::uuid[])`,
      [packageId, it.dedupe, JSON.stringify(it.payload), it.chapter, it.target, it.addressed]);
  }
}
