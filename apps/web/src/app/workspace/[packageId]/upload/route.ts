import { randomUUID } from "node:crypto";
import { SqlQueueStore } from "@alembic/package-ops";
import type { Role } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/request-origin";
import { directDb } from "@/lib/db";
import { checkUpload } from "@/lib/upload";
import { storeFigure } from "@/lib/store-figure";

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
  // An early refusal before reading the body: the size the request declares (the stored check runs on the bytes too).
  const early = checkUpload({ path, size: length, role: role as Role, counts: { byPersonLastHour: 0, byCourseLastHour: 0, courseBytes: 0 }, fromDoc });
  if (!early.ok && early.status !== 429 && early.status !== 507) return json(early.status, { ok: false, message: early.message });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length !== length) return json(400, { ok: false, message: "The file didn't arrive whole. Try again." });
  const stored = await storeFigure({ sql, packageId, uploader: user.id, role: role as Role, path, bytes, baseBlob, fromDoc });
  if (!stored.ok) return json(stored.status, { ok: false, message: stored.message });
  const check = { path: stored.path };
  const sha = stored.sha;
  const syncId = randomUUID();
  await new SqlQueueStore(sql).insert({
    packageId, kind: "sync", idem: syncId, actorId: user.id,
    payload: { files: [{ path: check.path, baseVersion: null, text: null, blob: { sha, size: bytes.length }, baseBlob }], fromOpenEditor: false, summary: `Added ${check.path.split("/").pop()}` },
  });
  return json(200, { ok: true, path: check.path, sha, syncId, nearLimit: stored.nearLimit });
}
