/**
 * The sync entry point (workspace v3, write path §2; queue-and-jobs §2.2):
 * check the caller's role and every path with the one permission matrix,
 * then insert one queue row with the service role. Fast, no GitHub calls.
 * The web server wraps this with the verified session (actor = the signed-in
 * user, never a body field) and the admin SQL client.
 */

import { can, editActionForPath, normalizePath, type Role } from "@alembic/package-contract";
import type { RowFile } from "./course-committer";
import type { SqlClient } from "./sql-queue-store";

export const MAX_SYNC_FILES = 50;
export const MAX_SYNC_BYTES = 2_000_000;

export class SyncRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SyncRefused";
  }
}

export interface SyncInput {
  /** The verified signed-in user (from the session, never the request body). */
  actorId: string;
  packageId: string;
  /** A UUID made by the client for this sync; repeats return the same row. */
  syncId: string;
  files: RowFile[];
  fromOpenEditor: boolean;
  kind?: "sync" | "restore";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function enqueueSync(sql: SqlClient, i: SyncInput): Promise<{ writeId: string; status: "queued" }> {
  if (!UUID.test(i.syncId)) throw new SyncRefused("bad sync id");
  if (i.files.length === 0 || i.files.length > MAX_SYNC_FILES) throw new SyncRefused("too many or no files");
  const bytes = i.files.reduce((n, f) => n + (f.text?.length ?? 0), 0);
  if (bytes > MAX_SYNC_BYTES) throw new SyncRefused("change too large");
  const { rows } = await sql.query<{ r: string | null }>(`select public.course_role_of($1, $2) as r`, [i.packageId, i.actorId]);
  const role = (rows[0]?.r ?? "none") as Role;
  if (role === "none") throw new SyncRefused("not a member of this course");
  for (const f of i.files) {
    try {
      normalizePath(f.path);
    } catch {
      throw new SyncRefused(`invalid path ${JSON.stringify(f.path)}`);
    }
    const action = editActionForPath(f.path);
    if (action === null || !can(role, action, { path: f.path, actorId: i.actorId })) throw new SyncRefused(`not allowed to change ${f.path}`);
    if (f.baseVersion !== null && !/^[0-9a-f]{64}$/.test(f.baseVersion)) throw new SyncRefused("bad base version");
  }
  const { rows: ins } = await sql.query<{ id: string }>(
    `select public.queue_insert($1, $2, $3, $4::jsonb, $5) as id`,
    [i.packageId, i.kind ?? "sync", i.syncId, JSON.stringify({ files: i.files, fromOpenEditor: i.fromOpenEditor }), i.actorId],
  );
  return { writeId: ins[0]!.id, status: "queued" };
}
