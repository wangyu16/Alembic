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
 * agent runs). An optional shared secret (`WORKER_TOKEN`) gates writes.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
  return {
    type: "generate-file",
    kind,
    markdown: d["markdown"],
    title: typeof d["title"] === "string" ? d["title"] : undefined,
    theme: typeof d["theme"] === "string" ? d["theme"] : undefined,
  };
}

function authorized(req: IncomingMessage): boolean {
  const token = process.env["WORKER_TOKEN"];
  if (!token) return true; // no secret configured → open (dev)
  return req.headers["authorization"] === `Bearer ${token}`;
}

export function createWorkerServer() {
  return createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "/";

      if (req.method === "GET" && url === "/health") {
        json(res, 200, { ok: true, rendererVersion: rendererVersion() });
        return;
      }

      if (req.method === "POST" && url === "/generate") {
        if (!authorized(req)) {
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
