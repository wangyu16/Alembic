import { enqueueSync, SyncRefused } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { directDb } from "@/lib/db";
import { requestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

/**
 * Send a document's text to the course (A7 sync entry) as a plain request
 * the browser finishes even while the person navigates away or closes the
 * tab (keepalive), unlike a server action (RC.13). Same rules as before:
 * signed in, same site only, one queue row per sync id.
 */
export async function POST(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if ((site && site !== "same-origin") || (origin && origin !== requestOrigin(req))) return Response.json({ ok: false, retryable: false, reason: "Not allowed." }, { status: 403 });
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return Response.json({ ok: false, retryable: false, reason: "Bad request." }, { status: 415 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, retryable: false, reason: "Sign in again to send your changes." }, { status: 401 });
  let a: { path?: unknown; text?: unknown; baseVersion?: unknown; syncId?: unknown };
  try { a = (await req.json()) as typeof a; } catch { return Response.json({ ok: false, retryable: false, reason: "Bad request." }, { status: 400 }); }
  if (typeof a.path !== "string" || typeof a.text !== "string" || typeof a.syncId !== "string" || !(a.baseVersion === null || typeof a.baseVersion === "string")) {
    return Response.json({ ok: false, retryable: false, reason: "Bad request." }, { status: 400 });
  }
  const sql = directDb();
  if (!sql) return Response.json({ ok: false, retryable: true, reason: "Sending isn't available here." }, { status: 503 });
  try {
    await enqueueSync(sql, { actorId: user.id, packageId, syncId: a.syncId, files: [{ path: a.path, baseVersion: a.baseVersion as string | null, text: a.text }], fromOpenEditor: true });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof SyncRefused) return Response.json({ ok: false, retryable: false, reason: e.reason });
    return Response.json({ ok: false, retryable: true, reason: "Couldn't reach Alembic." }, { status: 503 });
  }
}
