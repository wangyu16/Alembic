/**
 * Worker entry point. Runs the HTTP service (self-contained file generation
 * today; the async job queue for site builds / agent runs arrives with M6).
 * The web app reaches generation here because the Node-only, asset-reading
 * generators can't run in Vercel serverless.
 */

import { rendererVersion } from "@alembic/renderer";
import { createWorkerServer } from "./server";
import { ResendMailer } from "@alembic/notify";
import { SCHEDULES, postgrestRpc, startSchedules, type Schedule } from "./schedules";
import { runDigests } from "./digest-job";
import postgres from "postgres";
import { committerPass } from "./committer-loop";
import { hostname } from "node:os";

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
  const schedules: Schedule[] = [...SCHEDULES];
  // The Needs-you email (C8): only with an email service and the app's address.
  const resendKey = process.env["RESEND_API_KEY"]?.trim();
  const from = process.env["EMAIL_FROM"]?.trim();
  const appUrl = process.env["APP_URL"]?.trim();
  if (resendKey && from && appUrl) {
    const mailer = new ResendMailer(resendKey, from);
    schedules.push({ name: "needs-you-email", everyMs: 60 * 60_000, run: (rpc) => runDigests(rpc, { mailer, appUrl, actionSecret: process.env["ACTION_LINK_SECRET"]?.trim() || undefined }) });
  }
  startSchedules(postgrestRpc(dbUrl, dbKey), { schedules });
  console.log(`[alembic-worker] schedules on: ${schedules.map((s) => s.name).join(", ")}`);
} else {
  console.log("[alembic-worker] schedules off (SUPABASE_URL / SUPABASE_SECRET_KEY not set)");
}

// The write-queue consumer (A4): needs direct SQL and the GitHub App.
const databaseUrl = process.env["DATABASE_URL"]?.trim();
const appId = process.env["GITHUB_APP_ID"]?.trim();
const appKey = process.env["GITHUB_APP_PRIVATE_KEY"]?.replace(/\\n/g, "\n");
if (databaseUrl && appId && appKey) {
  const pg = postgres(databaseUrl, { ssl: "require", max: 3, idle_timeout: 30, prepare: false, onnotice: () => {} });
  const sql = { query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await pg.unsafe(text, (params ?? []) as never[])) as unknown as T[] }) };
  const holder = `worker-${hostname()}-${process.pid}`;
  startSchedules(async () => null, {
    schedules: [{ name: "committer", everyMs: 3000, run: () => committerPass({ sql, appId, privateKey: appKey, holder, log: (m) => console.log(`[alembic-worker] ${m}`) }) }],
  });
  console.log(`[alembic-worker] committer on (${holder})`);
} else {
  console.log("[alembic-worker] committer off (DATABASE_URL / GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not set)");
}
