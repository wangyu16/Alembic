import { randomUUID } from "node:crypto";
import { gitBlobSha } from "@alembic/github-bridge";
import { SqlQueueStore } from "@alembic/package-ops";
import type { Role } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/request-origin";
import { directDb } from "@/lib/db";
import { courseRepo } from "@/lib/course-v3";
import { githubBusy } from "@/lib/github-busy";
import { checkBytes, checkUpload, COURSE_WARN_BYTES } from "@/lib/upload";
import { checkPackageRateLimit, checkUserRateLimit } from "@/lib/rate-limit-server";

export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) => Response.json(body, { status });

/**
 * Add a figure or other non-text file to a course (package-contract-v3 §11.2): a same-site request from a member
 * who may write the path, with the raw bytes as the body and the path in `x-alembic-path` (`x-alembic-base-blob`:
 * the blob it replaces, if any). Checks, then the GitHub blob, then the ledger, then the queued change: the
 * committer accepts the blob only because it is in the ledger. Online only: if GitHub can't be reached nothing is
 * kept and the person is asked to try again (they still have the file).
 */
export async function POST(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if ((site && site !== "same-origin") || (origin && origin !== requestOrigin(req))) return json(403, { ok: false, message: "Not allowed." });
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return json(411, { ok: false, message: "The file's size is missing." });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json(401, { ok: false, message: "Sign in again, then add the file." });
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!role) return json(404, { ok: false, message: "Not found." });
  const sql = directDb();
  if (!sql) return json(503, { ok: false, message: "Files can't be added right now." });
  const header = (name: string) => { try { return decodeURIComponent(req.headers.get(name) ?? ""); } catch { return null; } };
  const path = header("x-alembic-path");
  // The document the figure is added from: a private document's figures must stay private (round 1 audit H2).
  const fromDoc = header("x-alembic-doc");
  if (path === null || fromDoc === null) return json(400, { ok: false, message: "That file name can't be used." });
  const baseBlob = req.headers.get("x-alembic-base-blob");
  if (baseBlob !== null && !/^[0-9a-f]{40}$/.test(baseBlob)) return json(400, { ok: false, message: "Bad request." });
  // Every attempt counts (round 1 audit M1: re-sending the same file used to add no ledger row).
  const [mine, course] = await Promise.all([checkUserRateLimit("upload", user.id), checkPackageRateLimit("uploadCourse", packageId)]);
  const { rows } = await sql.query<{ bytes: string }>(`select coalesce(sum(size), 0)::text as bytes from public.course_blobs where package_id = $1`, [packageId]);
  const counts = { byPersonLastHour: mine.ok ? 0 : Infinity, byCourseLastHour: course.ok ? 0 : Infinity, courseBytes: Number(rows[0]?.bytes ?? 0) };
  const check = checkUpload({ path, size: length, role: role as Role, counts, fromDoc });
  if (!check.ok) return json(check.status, { ok: false, message: check.message });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length !== length) return json(400, { ok: false, message: "The file didn't arrive whole. Try again." });
  const bad = checkBytes(check.kind, bytes);
  if (bad) return json(415, { ok: false, message: bad });
  const sha = gitBlobSha(bytes);
  // A different file already has this name (round 1 audit M3): never replace someone's figure by accident.
  const { rows: taken } = await sql.query<{ sha: string }>(`select sha from public.course_blobs where package_id = $1 and path = $2 and sha <> $3 limit 1`, [packageId, check.path, sha]);
  if (taken.length && !baseBlob) return json(409, { ok: false, message: "A different file already has that name. Rename yours and add it again." });
  // The same bytes already uploaded to this course: no second GitHub call (round 1 audit M1).
  const { rows: known } = await sql.query<{ n: number }>(`select count(*)::int as n from public.course_blobs where package_id = $1 and sha = $2`, [packageId, sha]);
  if (!known[0]?.n) {
    const c = await courseRepo(packageId);
    if (!c) return json(503, { ok: false, message: "This course can't be reached right now. Try again in a few minutes." });
    let made: string;
    try {
      made = await c.client.uploadBlob({ owner: c.owner, repo: c.name }, bytes);
    } catch (e) {
      const busy = githubBusy(e);
      return json(503, { ok: false, message: busy ? "GitHub is busy right now. Try again in a few minutes." : "Couldn't upload now. Try again in a few minutes." });
    }
    if (made !== sha) return json(502, { ok: false, message: "The file didn't arrive whole. Try again." });
  }
  await sql.query(
    `insert into public.course_blobs (package_id, sha, size, kind, path, uploaded_by) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
    [packageId, sha, bytes.length, check.kind, check.path, user.id]);
  const syncId = randomUUID();
  await new SqlQueueStore(sql).insert({
    packageId, kind: "sync", idem: syncId, actorId: user.id,
    payload: { files: [{ path: check.path, baseVersion: null, text: null, blob: { sha, size: bytes.length }, baseBlob }], fromOpenEditor: false, summary: `Added ${check.path.split("/").pop()}` },
  });
  return json(200, { ok: true, path: check.path, sha, syncId, nearLimit: counts.courseBytes + bytes.length > COURSE_WARN_BYTES });
}
