/**
 * Worker entry point. Runs the HTTP service (self-contained file generation
 * today; the async job queue for site builds / agent runs arrives with M6).
 * The web app reaches generation here because the Node-only, asset-reading
 * generators can't run in Vercel serverless.
 */

import { rendererVersion } from "@alembic/renderer";
import { createWorkerServer } from "./server";

const port = Number(process.env["WORKER_PORT"] ?? process.env["PORT"] ?? 8787);

createWorkerServer().listen(port, () => {
  console.log(`[alembic-worker] listening on :${port} (renderer: ${rendererVersion()})`);
  console.log("[alembic-worker] POST /generate · GET /health");
});
