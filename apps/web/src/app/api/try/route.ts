import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { mintGatewayKey } from "@alembic/package-ops";
import { directDb } from "@/lib/db";
import { runTry, type TryEvent } from "@/lib/try/pipeline";
import { tryDeps } from "@/lib/try/server";
import { EXAMPLES } from "@/lib/try/examples";
import { requestOrigin } from "@/lib/request-origin";
import { PARTS } from "@/lib/try/guides";
import { normalizeWorkshopCode, workshopCodeHash } from "@/lib/try/workshop";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ESTIMATE_CREDITS = 3; // a sample chapter on Haiku 5.5 costs well under this
const COOKIE = "alembic_try";

/**
 * Try mode (C7): make one short sample chapter for an anonymous visitor and
 * stream its progress as NDJSON events. Nothing is saved; only hashes of the
 * browser token and network address are kept, for the daily caps.
 */
export async function POST(req: Request) {
  const sql = directDb();
  const gateway = process.env["TRY_GATEWAY_URL"];
  const secret = process.env["RATE_LIMIT_SECRET"];
  if (!sql || !gateway || !secret) return Response.json({ error: "Try mode isn't available here." }, { status: 503 });
  // Only this site's own page may start a run (review r4 M2: no cross-site starts).
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return Response.json({ error: "bad request" }, { status: 415 });
  if ((site && site !== "same-origin") || (origin && origin !== requestOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let input: { topic?: unknown; level?: unknown; code?: unknown };
  try { input = (await req.json()) as typeof input; } catch { return Response.json({ error: "bad request" }, { status: 400 }); }
  const topic = typeof input.topic === "string" ? input.topic.trim().slice(0, 120) : "";
  const level = typeof input.level === "string" ? input.level.trim().slice(0, 60) : "";
  if (topic.length < 2) return Response.json({ error: "Name a topic." }, { status: 400 });
  // A workshop code (optional): the workshop's credit pays, and the per-network limit doesn't apply (design §11.5).
  const rawCode = typeof input.code === "string" ? input.code.trim().slice(0, 40) : "";
  const code = rawCode ? normalizeWorkshopCode(rawCode) : null;
  if (rawCode && !code) return Response.json({ error: "That workshop code isn't valid. Check it, or leave it empty." }, { status: 400 });

  const jar = await cookies();
  let browser = jar.get(COOKIE)?.value;
  if (!browser || !/^[A-Za-z0-9_-]{20,64}$/.test(browser)) {
    browser = randomBytes(18).toString("base64url");
    jar.set(COOKIE, browser, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 30, path: "/" });
  }
  const h = await headers();
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const hash = (v: string) => createHash("sha256").update(`${secret}:try:${v}`).digest("hex");
  // An IPv6 visitor usually holds a whole /64: count the network, not the address (review r4 M1).
  const network = ip.includes(":") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip;

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: TryEvent | { type: "notice"; message: string }) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      let job: string | null = null;
      try {
        try {
          const { rows } = code
            ? await sql.query<{ j: string }>(`select public.try_start_workshop($1, $2, $3, $4) as j`, [workshopCodeHash(code, secret), hash(browser!), hash(network), ESTIMATE_CREDITS])
            : await sql.query<{ j: string }>(`select public.try_start($1, $2, $3) as j`, [hash(browser!), hash(network), ESTIMATE_CREDITS]);
          job = rows[0]!.j;
        } catch (e) {
          const msg = (e as Error).message;
          if (/workshop code isn't valid/.test(msg)) {
            emit({ type: "error", message: "That workshop code isn't valid or has ended. Check it with your workshop leader, or leave it empty." });
            return;
          }
          // Resting (no budget), daily caps, or the budget used up: ready-made sample instead.
          emit({ type: "notice", message: /limit/.test(msg) ? "You've reached today's limit for sample chapters. Here is a ready-made one." : "Try mode is resting right now. Here is a ready-made sample chapter." });
          for (const p of PARTS) {
            emit({ type: "file", part: p.id, path: EXAMPLES[p.id].path, kind: p.kind, text: EXAMPLES[p.id].text });
            emit({ type: "step", part: p.id, title: p.title, purpose: p.purpose, status: "example" });
          }
          emit({ type: "done" });
          return;
        }
        const key = await mintGatewayKey(sql, job, ["claude-haiku-5-5"], 15);
        await runTry({ topic, level }, await tryDeps(gateway, key), emit);
      } catch (e) {
        console.error("try mode:", (e as Error).message);
        emit({ type: "error", message: "Something went wrong while making the sample. Please try again." });
      } finally {
        if (job) await sql.query(`select public.try_finish($1)`, [job]).catch((e) => console.error("try_finish:", (e as Error).message));
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
