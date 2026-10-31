import { parsePush, verifyGithubWebhook } from "@alembic/package-ops";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const MAX_BODY = 5 * 1024 * 1024; // GitHub caps payloads at 25 MB; pushes Alembic cares about are far smaller

/**
 * GitHub App webhook (B1, Door C). Verifies the signature, records the
 * delivery (ids only; contents are re-fetched as the App when processed) and
 * answers fast. Not configured → 503; bad signature → 401. A delivery seen
 * before (GitHub retries reuse its id) is acknowledged once.
 */
export async function POST(req: Request) {
  const secret = process.env["GITHUB_WEBHOOK_SECRET"];
  const db = createServiceClient();
  if (!secret || !db) return new Response("not configured", { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response("too large", { status: 413 });
  if (!verifyGithubWebhook(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return new Response("bad signature", { status: 401 });
  }
  const delivery = req.headers.get("x-github-delivery") ?? "";
  const event = req.headers.get("x-github-event") ?? "";
  if (!/^[0-9a-f-]{8,64}$/i.test(delivery) || !/^[a-z_]{1,40}$/.test(event)) return new Response("bad headers", { status: 400 });
  if (event === "ping") return Response.json({ ok: true, event });

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad body", { status: 400 }); }
  const b = body as { installation?: { id?: unknown }; repository?: { id?: unknown; full_name?: unknown } };
  const push = event === "push" ? parsePush(body) : null;
  if (event === "push" && !push) return new Response("malformed push", { status: 400 });

  const row: Record<string, unknown> = push
    ? {
        delivery_id: delivery, event, installation_id: push.installationId, repo_id: push.repoId, repo_full_name: push.repoFullName,
        ref: push.ref, before_sha: push.before, after_sha: push.after, forced: push.forced, pusher_login: push.pusherLogin, commit_ids: push.commitIds,
      }
    : {
        delivery_id: delivery, event,
        installation_id: typeof b.installation?.id === "number" ? b.installation.id : null,
        repo_id: typeof b.repository?.id === "number" ? b.repository.id : null,
        repo_full_name: typeof b.repository?.full_name === "string" ? b.repository.full_name : null,
      };
  const { error } = await db.from("github_events").upsert(row, { onConflict: "delivery_id", ignoreDuplicates: true });
  if (error) return new Response("retry", { status: 500 }); // GitHub redelivers on failure
  return Response.json({ ok: true, event });
}
