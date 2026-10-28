/**
 * The Publish job's records over Postgres (migration 0042; publisher-v3 §3).
 * Service-role only: the worker runs Publish, so these writes bypass RLS.
 * jsonb parameters go in as text (`$n::text::jsonb`): postgres.js would
 * otherwise encode an already-stringified value a second time.
 */
import type { Role } from "@alembic/package-contract";
import type { PublishedRecord, PublishStore } from "./publish-job";
import { SqlQueueStore, type SqlClient } from "./sql-queue-store";

export interface PublishStoreDeps {
  /** A public file at a commit: its text, `binary`, or null when absent. */
  readPublic(sha: string, path: string): Promise<{ text: string } | "binary" | null>;
  /** How long to wait for brought-in drift to land in the working repo. */
  driftWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const json = (v: unknown) => JSON.stringify(v);
const parse = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

export class SqlPublishStore implements PublishStore {
  constructor(private readonly sql: SqlClient, private readonly deps: PublishStoreDeps) {}

  async acknowledged(packageId: string): Promise<string | null> {
    const { rows } = await this.sql.query<{ public_sha: string }>(
      `select public_sha from public.public_acknowledged where package_id = $1`, [packageId]);
    return rows[0]?.public_sha ?? null;
  }

  async acknowledge(packageId: string, publicSha: string): Promise<void> {
    await this.sql.query(
      `insert into public.public_acknowledged (package_id, public_sha) values ($1, $2)
       on conflict (package_id) do update set public_sha = excluded.public_sha, updated_at = now()`, [packageId, publicSha]);
  }

  async anyCommittedRun(packageId: string): Promise<boolean> {
    const { rows } = await this.sql.query<{ n: number }>(
      `select count(*)::int as n from public.publish_runs where package_id = $1 and status in ('committed', 'site-built', 'site-failed')`, [packageId]);
    return (rows[0]?.n ?? 0) > 0;
  }

  async pendingRun(packageId: string, runId: string): Promise<{ id: string; intendedFiles: PublishedRecord[] } | null> {
    const { rows } = await this.sql.query<{ id: string; intended: unknown }>(
      `select id, intended from public.publish_runs where package_id = $1 and id = $2 and status in ('pending', 'stopped')`, [packageId, runId]);
    return rows[0] ? { id: rows[0].id, intendedFiles: parse<PublishedRecord[]>(rows[0].intended) } : null;
  }

  /** Marked stopped although its commit landed (review M1): `pendingRun` also finds stopped runs; this finds recorded ones. */
  async isCommitted(packageId: string, runId: string): Promise<boolean> {
    const { rows } = await this.sql.query<{ n: number }>(
      `select count(*)::int as n from public.publish_runs where package_id = $1 and id = $2 and status in ('committed', 'site-built', 'site-failed')`, [packageId, runId]);
    return (rows[0]?.n ?? 0) > 0;
  }

  async insertPendingRun(r: { id: string; packageId: string; by: string; workingSha: string; publicParent: string | null; choices: unknown; intendedFiles: PublishedRecord[] }): Promise<void> {
    await this.sql.query(
      `insert into public.publish_runs (id, package_id, by_user, working_sha, public_parent, status, choices, intended)
       values ($1, $2, $3, $4, $5, 'pending', $6::text::jsonb, $7::text::jsonb)`,
      [r.id, r.packageId, r.by, r.workingSha, r.publicParent, json(r.choices), json(r.intendedFiles)]);
  }

  /** The run and the per-file records change together: one statement, so a crash leaves both or neither. */
  async markCommitted(runId: string, publicSha: string, files: PublishedRecord[], results: unknown): Promise<void> {
    for (const f of files) if (!f.blobSha) throw new Error(`no blob id for ${f.path}`);
    await this.sql.query(
      `with run as (
         update public.publish_runs set status = 'committed', public_sha = $2, committed_at = now(), results = $4::text::jsonb
          where id = $1 and status in ('pending', 'stopped') returning package_id
       ), gone as (
         delete from public.published_files
          where package_id = (select package_id from run)
            and path not in (select f.path from jsonb_to_recordset($3::text::jsonb) as f(path text))
       )
       insert into public.published_files (package_id, path, unit, blob_sha, version, run_id)
       select (select package_id from run), f.path, f.unit, f."blobSha", f.version, $1
         from jsonb_to_recordset($3::text::jsonb) as f(path text, unit text, "blobSha" text, version text)
        where exists (select 1 from run)
       on conflict (package_id, path) do update set unit = excluded.unit, blob_sha = excluded.blob_sha, version = excluded.version, run_id = excluded.run_id`,
      [runId, publicSha, json(files), json(results ?? {})]);
  }

  async markStopped(runId: string, reason: string): Promise<void> {
    await this.sql.query(
      `update public.publish_runs set status = 'stopped', results = results || jsonb_build_object('stopped', $2::text) where id = $1 and status = 'pending'`,
      [runId, reason]);
  }

  async publishedFiles(packageId: string): Promise<PublishedRecord[]> {
    const { rows } = await this.sql.query<{ path: string; unit: string; blob_sha: string; version: string | null }>(
      `select path, unit, blob_sha, version from public.published_files where package_id = $1 order by path`, [packageId]);
    return rows.map((r) => ({ path: r.path, unit: r.unit, blobSha: r.blob_sha, version: r.version }));
  }

  async approvedAt(packageId: string, parts: Array<{ path: string; version: string }>): Promise<Set<string>> {
    if (parts.length === 0) return new Set();
    const { rows } = await this.sql.query<{ part_path: string }>(
      `select a.part_path from public.approvals a
         join jsonb_to_recordset($2::text::jsonb) as x(path text, version text) on a.part_path = x.path and a.version = x.version
        where a.package_id = $1`, [packageId, json(parts)]);
    return new Set(rows.map((r) => r.part_path));
  }

  async approve(packageId: string, by: string, role: Role, parts: Array<{ path: string; version: string }>): Promise<void> {
    if (role !== "owner" && role !== "deputy") throw new Error("Only the owner or deputy approves the course plan");
    for (const p of parts) {
      await this.sql.query(
        `insert into public.approvals (package_id, part_path, version, approver_id, approver_role) values ($1, $2, $3, $4, $5) on conflict do nothing`,
        [packageId, p.path, p.version, by, role]);
    }
  }

  /**
   * One system row writes the public copy's changes into the working repo,
   * each file on top of the version that was published (so the version rule
   * merges it with work done since). A file that isn't text can't travel in a
   * queue row: the drift is then reported as not brought in.
   */
  async bringInDrift(packageId: string, publicSha: string, paths: string[]): Promise<"done" | "not-done"> {
    const published = new Map((await this.publishedFiles(packageId)).map((f) => [f.path, f.version]));
    const files = [];
    for (const path of paths) {
      const f = await this.deps.readPublic(publicSha, path);
      if (f === "binary") return "not-done";
      files.push({ path, baseVersion: published.get(path) ?? null, text: f === null ? null : f.text });
    }
    // One row per public head, unless the last attempt for it ended badly: then a new attempt (review L1).
    const { rows: prior } = await this.sql.query<{ status: string }>(
      `select status from public.write_queue where package_id = $1 and kind = 'system' and idem_key like $2 order by seq desc`,
      [packageId, `system:drift:${publicSha}%`]);
    const ended = prior.length > 0 && ["bounced", "refused", "failed"].includes(prior[0]!.status);
    const attempt = ended ? prior.length : Math.max(prior.length - 1, 0); // reuse the open or landed attempt
    const id = await new SqlQueueStore(this.sql).insert({
      packageId, kind: "system", idem: attempt === 0 ? `drift:${publicSha}` : `drift:${publicSha}:${attempt}`, priority: 1,
      payload: { files, summary: "Bring in changes made to the public copy on GitHub" },
    });
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const until = Date.now() + (this.deps.driftWaitMs ?? 90_000);
    while (Date.now() < until) {
      const { rows } = await this.sql.query<{ status: string }>(`select status from public.write_queue where id = $1`, [id]);
      const s = rows[0]?.status;
      if (s === "done") return "done";
      if (s === "bounced" || s === "refused" || s === "failed") return "not-done";
      await sleep(2000);
    }
    return "not-done";
  }
}
