/**
 * Worker HTTP surface. The web app (Vercel serverless) can't run the Node-only,
 * asset-reading file generators, so it calls this service instead. Minimal
 * `node:http` — no framework — matching the repo's dependency ethos.
 *
 * Endpoints:
 *   GET  /health    → { ok, rendererVersion }
 *   POST /generate  → GenerateFileJob body → GenerateFileResult
 *
 * Generation is fast (sub-second), so it is served synchronously here rather
 * than through the async job queue (which stays for long jobs: site builds,
 * agent runs). A shared secret (`WORKER_TOKEN`) gates every write and fails
 * CLOSED: with the token unset the worker refuses `/generate` (503) and
 * reports itself unhealthy, rather than serving anyone unauthenticated
 * (P5.S.11). Local dev sets any token on both sides (`.env.example`).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { rendererVersion } from "@alembic/renderer";
import { handleGenerateFile, type GenerateFileJob } from "./jobs";

const MAX_BODY_BYTES = 8 * 1024 * 1024; // generous: source is small, output isn't sent in

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Sanitize the untrusted `metadata` object into a DocMeta, keeping only known
 * string fields. The orz builders escape these into the <head>, but the worker
 * still validates fail-closed: an unexpected shape yields `undefined`, never a
 * throw, so a malformed field cannot break generation.
 */
function parseMetadata(v: unknown): GenerateFileJob["metadata"] {
  if (typeof v !== "object" || v === null) return undefined;
  const m = v as Record<string, unknown>;
  const lic = typeof m["license"] === "object" && m["license"] !== null
    ? (m["license"] as Record<string, unknown>)
    : undefined;
  const license = lic
    ? { spdx: str(lic["spdx"]), name: str(lic["name"]), url: str(lic["url"]) }
    : undefined;
  const keywords = Array.isArray(m["keywords"])
    ? m["keywords"].filter((k): k is string => typeof k === "string")
    : undefined;
  const meta = {
    title: str(m["title"]),
    author: str(m["author"]),
    description: str(m["description"]),
    source: str(m["source"]),
    date: str(m["date"]),
    // Durable document identity (U2): the host's stable docId, embedded into the
    // #orz-meta island so a re-uploaded copy keeps its permalink. Opaque string.
    uid: str(m["uid"]),
    ...(license && (license.spdx || license.name || license.url) ? { license } : {}),
    ...(keywords && keywords.length ? { keywords } : {}),
  };
  // Drop it entirely when nothing usable survived.
  return Object.values(meta).some((x) => x !== undefined) ? meta : undefined;
}

/** Validate the untrusted body into a GenerateFileJob (fail-closed). */
function parseGenerateJob(raw: string): GenerateFileJob | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const kind = d["kind"];
  if (kind !== "md" && kind !== "slides" && kind !== "paged") return null;
  if (typeof d["markdown"] !== "string") return null;
  const delivery = d["delivery"] === "cdn" ? "cdn" : d["delivery"] === "inline" ? "inline" : undefined;
  return {
    type: "generate-file",
    kind,
    markdown: d["markdown"],
    title: typeof d["title"] === "string" ? d["title"] : undefined,
    theme: typeof d["theme"] === "string" ? d["theme"] : undefined,
    delivery,
    metadata: parseMetadata(d["metadata"]),
  };
}

/** The configured shared secret, or null when unset/blank (→ fail closed). */
function workerToken(): string | null {
  const token = process.env["WORKER_TOKEN"]?.trim();
  return token ? token : null;
}

/** Constant-time comparison of the bearer header against the secret. */
function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${token}`));
}

export function createWorkerServer() {
  return createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "/";

      const token = workerToken();

      if (req.method === "GET" && url === "/health") {
        if (!token) {
          json(res, 503, { ok: false, message: "Worker not configured." });
          return;
        }
        json(res, 200, { ok: true, rendererVersion: rendererVersion() });
        return;
      }

      if (req.method === "POST" && url === "/generate") {
        if (!token) {
          json(res, 503, { ok: false, message: "Worker not configured." });
          return;
        }
        if (!authorized(req, token)) {
          json(res, 401, { ok: false, message: "Unauthorized." });
          return;
        }
        let raw: string;
        try {
          raw = await readBody(req);
        } catch {
          json(res, 413, { ok: false, message: "Request too large." });
          return;
        }
        const job = parseGenerateJob(raw);
        if (!job) {
          json(res, 400, { ok: false, message: "Invalid generate request." });
          return;
        }
        const result = await handleGenerateFile(job);
        json(res, result.ok ? 200 : 500, result);
        return;
      }

      json(res, 404, { ok: false, message: "Not found." });
    })().catch(() => {
      if (!res.headersSent) json(res, 500, { ok: false, message: "Worker error." });
    });
  });
}
