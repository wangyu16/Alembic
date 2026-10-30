/**
 * The worker's background half (no HTTP server, no file generation): the
 * write-queue committer and the scheduled jobs. The testing VM runs this;
 * the generators (0.x carriers) aren't needed where documents are edited in
 * the browser with the 1.x editors.
 */
import { hostname } from "node:os";
import postgres from "postgres";
import { ResendMailer } from "@alembic/notify";
import { SCHEDULES, postgrestRpc, startSchedules, type Schedule } from "./schedules";
import { runDigests } from "./digest-job";
import { providerFromEnv } from "@alembic/ai-assist";
import { TRIAGE_EVERY_MS, dailyCapFromEnv, runContactTriage } from "./contact-triage-job";
import { committerPass } from "./committer-loop";
import { doorCPass } from "./door-c-loop";
import { publishPass } from "./publish-loop";
import { siteBuildPass } from "./site-build-loop";
import { childProcessBuilder } from "./orz-site-builder";
import { fileURLToPath } from "node:url";

const log = (m: string) => console.log(`[alembic-worker] ${m}`);

const dbUrl = process.env["SUPABASE_URL"]?.trim();
const dbKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
if (dbUrl && dbKey) {
  const schedules: Schedule[] = [...SCHEDULES];
  const resendKey = process.env["RESEND_API_KEY"]?.trim();
  const from = process.env["EMAIL_FROM"]?.trim();
  const appUrl = process.env["APP_URL"]?.trim();
  if (resendKey && from && appUrl) {
    const mailer = new ResendMailer(resendKey, from);
    schedules.push({ name: "needs-you-email", everyMs: 60 * 60_000, run: (rpc) => runDigests(rpc, { mailer, appUrl, actionSecret: process.env["ACTION_LINK_SECRET"]?.trim() || undefined }) });
  }
  // Sorting contact-form messages: only with an AI provider configured; without one they stay unsorted (still
  // shown). (It was registered only in index.ts, which this deployment doesn't run.)
  const ai = providerFromEnv(process.env);
  if (ai) {
    const dailyCap = dailyCapFromEnv(process.env["CONTACT_TRIAGE_DAILY_CAP"]);
    schedules.push({ name: "contact-triage", everyMs: TRIAGE_EVERY_MS, run: (rpc) => runContactTriage(rpc, { ...ai, dailyCap }) });
  }
  startSchedules(postgrestRpc(dbUrl, dbKey), { schedules });
  log(`schedules on: ${schedules.map((s) => s.name).join(", ")}`);
} else {
  log("schedules off (SUPABASE_URL / SUPABASE_SECRET_KEY not set)");
}

const databaseUrl = process.env["DATABASE_URL"]?.trim();
const appId = process.env["GITHUB_APP_ID"]?.trim();
const appKey = process.env["GITHUB_APP_PRIVATE_KEY"]?.replace(/\\n/g, "\n");
if (databaseUrl && appId && appKey) {
  const pg = postgres(databaseUrl, { ssl: "require", max: 3, idle_timeout: 30, prepare: false, onnotice: () => {} });
  const sql = { query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await pg.unsafe(text, (params ?? []) as never[])) as unknown as T[] }) };
  const templateOwner = process.env["GITHUB_TEMPLATE_OWNER"]?.trim();
  const publicTemplate = process.env["GITHUB_PUBLIC_TEMPLATE"]?.trim();
  const site = childProcessBuilder(fileURLToPath(new URL("./site-child.mjs", import.meta.url)));
  const holder = `worker-${hostname()}-${process.pid}`;
  startSchedules(async () => null, {
    schedules: [
      { name: "committer", everyMs: 3000, run: () => committerPass({ sql, appId, privateKey: appKey, holder, log }) },
      { name: "door-c", everyMs: 5000, run: () => doorCPass({ sql, appId, privateKey: appKey, log }) },
      ...(templateOwner && publicTemplate
        ? [{ name: "publish", everyMs: 4000, run: () => publishPass({ sql, appId, privateKey: appKey, templateOwner, publicTemplate, log }) }]
        : []),
      // Each website build runs in its own child process (bundled next to this file as site-child.mjs).
      { name: "site-build", everyMs: 10_000, run: () => siteBuildPass({ sql, appId, privateKey: appKey, log, site }) },
    ],
    log,
  });
  log(`committer, door C${templateOwner && publicTemplate ? " and publish" : ""} on (${holder})`);
} else {
  log("committer off (DATABASE_URL / GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not set)");
}
