/**
 * QueueStore over the Postgres functions of migration 0037, through a
 * minimal SQL seam (`query(text, params) → { rows }`) that both PGlite (tests)
 * and a node-postgres pool (the worker) satisfy. Runs as the service role.
 */

import type { Role } from "@alembic/package-contract";
import type { QueueRow, QueueStore, RowKind, RowStatus } from "./course-committer";

export interface SqlClient {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface Raw {
  id: string;
  package_id: string;
  kind: RowKind;
  actor_id: string | null;
  invoker_id: string | null;
  attempts: number;
  abandons: number;
  planned_shas: string[] | null;
  created_at: string | Date;
  payload: QueueRow["payload"] | string;
}

export class SqlQueueStore implements Omit<QueueStore, "baseText"> {
  constructor(private readonly sql: SqlClient) {}

  async acquire(packageId: string, holder: string): Promise<string | null> {
    const { rows } = await this.sql.query<{ f: string | number | null }>(`select public.committer_acquire($1, $2) as f`, [packageId, holder]);
    const f = rows[0]?.f;
    return f === null || f === undefined ? null : String(f);
  }

  async next(packageId: string, holder: string, fence: string): Promise<QueueRow | undefined> {
    const { rows } = await this.sql.query<Raw>(
      `select id, package_id, kind, actor_id, invoker_id, attempts, abandons, planned_shas, created_at, payload from public.committer_next($1, $2, $3)`,
      [packageId, holder, fence],
    );
    const r = rows[0];
    if (!r) return undefined;
    // Compared in SQL (microseconds), not through JS dates (G2 r3 LOW).
    const { rows: c } = await this.sql.query<{ after: boolean }>(
      `select coalesce(q.created_at < c.last_retry_at, false) as after
         from public.write_queue q left join public.course_committer c on c.package_id = q.package_id
        where q.id = $1`,
      [r.id],
    );
    return {
      abandons: Number(r.abandons ?? 0),
      plannedShas: r.planned_shas ?? [],
      afterOutage: c[0]?.after === true,
      id: r.id,
      packageId: r.package_id,
      kind: r.kind,
      actorId: r.actor_id,
      invokerId: r.invoker_id,
      attempts: Number(r.attempts),
      payload: typeof r.payload === "string" ? (JSON.parse(r.payload) as QueueRow["payload"]) : r.payload,
    };
  }

  async finish(i: { id: string; holder: string; fence: string; status: RowStatus; result?: unknown; error?: string; retryAfterSeconds?: number }): Promise<void> {
    await this.sql.query(`select public.committer_finish($1, $2, $3, $4, $5::text::jsonb, $6, $7)`, [
      i.id,
      i.holder,
      i.fence,
      i.status,
      i.result === undefined ? null : JSON.stringify(i.result),
      i.error ?? null,
      i.retryAfterSeconds ?? null,
    ]);
  }

  async claimCurrent(rowId: string, holder: string, fence: string, attempts: number): Promise<boolean> {
    const { rows } = await this.sql.query<{ ok: boolean }>(`select public.committer_claim_current($1, $2, $3, $4) as ok`, [rowId, holder, fence, attempts]);
    return rows[0]?.ok === true;
  }

  async recordPlanned(rowId: string, holder: string, fence: string, attempts: number, shas: string[]): Promise<void> {
    await this.sql.query(`select public.committer_record_planned($1, $2, $3, $4, $5::text[])`, [rowId, holder, fence, attempts, shas]);
  }

  async roleOf(packageId: string, userId: string): Promise<Role> {
    const { rows } = await this.sql.query<{ r: string | null }>(`select public.course_role_of($1, $2) as r`, [packageId, userId]);
    const r = rows[0]?.r;
    return r === "owner" || r === "deputy" || r === "co-author" ? r : "none";
  }

  /** Is this blob in the course's upload ledger for this kind of file? (contract v3 §11.2, K1.10) */
  async blobKnown(packageId: string, sha: string, kind: string): Promise<boolean> {
    const { rows } = await this.sql.query<{ n: number }>(`select count(*)::int as n from public.course_blobs where package_id = $1 and sha = $2 and kind = $3`, [packageId, sha, kind]);
    return (rows[0]?.n ?? 0) > 0;
  }

  /** Insert a row (service role): returns its id. */
  async insert(i: { packageId: string; kind: RowKind; idem: string; payload: QueueRow["payload"]; actorId?: string | null; invokerId?: string | null; pusher?: string | null; priority?: 0 | 1; dependsOn?: string | null }): Promise<string> {
    const { rows } = await this.sql.query<{ id: string }>(
      `select public.queue_insert($1, $2, $3, $4::text::jsonb, $5, $6, $7, $8::smallint, $9) as id`,
      [i.packageId, i.kind, i.idem, JSON.stringify(i.payload), i.actorId ?? null, i.invokerId ?? null, i.pusher ?? null, i.priority ?? 0, i.dependsOn ?? null],
    );
    return rows[0]!.id;
  }
}
