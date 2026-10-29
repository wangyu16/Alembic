/**
 * Queue a course operation (package-contract-v3 §13): one `courseop` row with
 * the operation and its arguments. The worker re-checks the actor's right and
 * applies it at the head; no GitHub call here. `tag` goes into the queue key,
 * which members can read, so pages can show what is still on its way (e.g.
 * `mode:<slug>:<mode>`).
 */
import { randomUUID } from "node:crypto";
import { SqlQueueStore, type CourseOp } from "@alembic/package-ops";
import { directDb } from "./db";

export async function queueCourseOp(packageId: string, actorId: string, op: CourseOp, tag: string = op.op): Promise<boolean> {
  const sql = directDb();
  if (!sql) return false;
  await new SqlQueueStore(sql).insert({ packageId, kind: "courseop", idem: `${tag}:${randomUUID()}`, actorId, payload: { files: [], op } });
  return true;
}

/** Queue keys of chapter status changes, old (system rows) and new (course operations). */
export const MODE_KEY = /^(?:system|courseop):mode:([a-z0-9-]+):(draft|package):/;
