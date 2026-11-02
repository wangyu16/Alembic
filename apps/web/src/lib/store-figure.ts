import "server-only";
import { gitBlobSha } from "@alembic/github-bridge";
import type { Role } from "@alembic/package-contract";
import type { SqlClient } from "@alembic/package-ops";
import { courseRepo } from "@/lib/course-v3";
import { githubBusy } from "@/lib/github-busy";
import { checkBytes, checkUpload, COURSE_WARN_BYTES } from "@/lib/upload";
import { checkPackageRateLimit, checkUserRateLimit } from "@/lib/rate-limit-server";

export type StoredFigure =
  | { ok: true; path: string; sha: string; size: number; nearLimit: boolean }
  | { ok: false; status: number; message: string };

/**
 * A figure or other non-text file into a course (package-contract-v3 §11.2; agent-runtime §11.1): the upload checks,
 * then the GitHub blob, then the ledger row — the committer accepts a blob only because it is in the ledger. One path
 * for people and the assistant alike: the assistant's rights are its own capped by its asker's (`mayWrite`), and its
 * uploads count against its asker and the course.
 */
export async function storeFigure(i: {
  sql: SqlClient; packageId: string; uploader: string; role: Role; path: string; bytes: Uint8Array;
  baseBlob: string | null; fromDoc?: string; mayWrite?: (path: string) => boolean;
}): Promise<StoredFigure> {
  const { sql, packageId } = i;
  // Every attempt counts (round 1 audit M1: re-sending the same file used to add no ledger row).
  const [mine, course] = await Promise.all([checkUserRateLimit("upload", i.uploader), checkPackageRateLimit("uploadCourse", packageId)]);
  const { rows } = await sql.query<{ bytes: string }>(`select coalesce(sum(size), 0)::text as bytes from public.course_blobs where package_id = $1`, [packageId]);
  const counts = { byPersonLastHour: mine.ok ? 0 : Infinity, byCourseLastHour: course.ok ? 0 : Infinity, courseBytes: Number(rows[0]?.bytes ?? 0) };
  const check = checkUpload({ path: i.path, size: i.bytes.length, role: i.role, counts, ...(i.fromDoc !== undefined ? { fromDoc: i.fromDoc } : {}), ...(i.mayWrite ? { mayWrite: i.mayWrite } : {}) });
  if (!check.ok) return check;
  const bad = checkBytes(check.kind, i.bytes);
  if (bad) return { ok: false, status: 415, message: bad };
  const sha = gitBlobSha(i.bytes);
  // A different file already has this name (round 1 audit M3): never replace someone's figure by accident.
  const { rows: taken } = await sql.query<{ sha: string }>(`select sha from public.course_blobs where package_id = $1 and path = $2 and sha <> $3 limit 1`, [packageId, check.path, sha]);
  if (taken.length && !i.baseBlob) return { ok: false, status: 409, message: "A different file already has that name. Rename yours and add it again." };
  // The same bytes already uploaded to this course: no second GitHub call (round 1 audit M1).
  const { rows: known } = await sql.query<{ n: number }>(`select count(*)::int as n from public.course_blobs where package_id = $1 and sha = $2`, [packageId, sha]);
  if (!known[0]?.n) {
    const c = await courseRepo(packageId);
    if (!c) return { ok: false, status: 503, message: "This course can't be reached right now. Try again in a few minutes." };
    let made: string;
    try {
      made = await c.client.uploadBlob({ owner: c.owner, repo: c.name }, i.bytes);
    } catch (e) {
      return { ok: false, status: 503, message: githubBusy(e) ? "GitHub is busy right now. Try again in a few minutes." : "Couldn't upload now. Try again in a few minutes." };
    }
    if (made !== sha) return { ok: false, status: 502, message: "The file didn't arrive whole. Try again." };
  }
  await sql.query(
    `insert into public.course_blobs (package_id, sha, size, kind, path, uploaded_by) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
    [packageId, sha, i.bytes.length, check.kind, check.path, i.uploader]);
  return { ok: true, path: check.path, sha, size: i.bytes.length, nearLimit: counts.courseBytes + i.bytes.length > COURSE_WARN_BYTES };
}
