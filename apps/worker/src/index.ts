/**
 * Worker entry point. Runs the HTTP service (self-contained file generation
 * today; the async job queue for site builds / agent runs arrives with M6).
 * The web app reaches generation here because the Node-only, asset-reading
 * generators can't run in Vercel serverless.
 */

import { rendererVersion } from "@alembic/renderer";
import { createWorkerServer } from "./server";
import { postgrestRpc, startSchedules } from "./schedules";

const port = Number(process.env["WORKER_PORT"] ?? process.env["PORT"] ?? 8787);

if (!process.env["WORKER_TOKEN"]?.trim()) {
  // Fail closed (P5.S.11): the server refuses every request without it; say why.
  console.error("[alembic-worker] WORKER_TOKEN is not set: every request will be refused (503).");
}

createWorkerServer().listen(port, () => {
  console.log(`[alembic-worker] listening on :${port} (renderer: ${rendererVersion()})`);
  console.log("[alembic-worker] POST /generate · GET /health");
});

// Periodic ledger jobs (A15): only when the worker is given database access.
const dbUrl = process.env["SUPABASE_URL"]?.trim();
const dbKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
if (dbUrl && dbKey) {
  startSchedules(postgrestRpc(dbUrl, dbKey));
  console.log("[alembic-worker] schedules on: ledger-orphan-sweep (5 min), ledger-month-end (1 h)");
} else {
  console.log("[alembic-worker] schedules off (SUPABASE_URL / SUPABASE_SECRET_KEY not set)");
}
