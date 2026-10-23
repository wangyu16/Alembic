/**
 * Filing a portal report (Phase 5 hardening, migration 0024; security loop r1
 * M4, migration 0025_loop_r1_3: `file_portal_report_v2` validates the package
 * is listed before charging any cap and caps per (package, reporter key)).
 *
 * The only insert path into `portal_reports` is the security-definer
 * function `file_portal_report`, executable by the service role only; it
 * applies per-package and global caps (10 / h and 30 / day per package, 60 / h
 * and 300 / day overall) through `rate_limit_hit`. The public anon key can no
 * longer insert reports directly, so the app's per-address limit
 * (`lib/rate-limit.ts`) and the database caps cannot be bypassed.
 *
 * Until 0024 is applied the function does not exist: the report falls back to
 * the old direct insert through the visitor's session (RLS still allowed it
 * then). Only a "function not found" answer falls back — any other error is
 * an error, so a cap can never be skipped by app logic.
 *
 * Pure apart from its injected clients, so it is unit-tested
 * (`report-submit.test.ts`).
 */

import { createHmac } from "node:crypto";
import type { RpcClient } from "./rate-limit";

export type ReportOutcome = "ok" | "rate_limited" | "invalid" | "error";

export interface ReportInput {
  packageId: string;
  /** Trimmed and capped here; blank is refused. */
  reason: string;
  /** The verified signed-in user, or null for an anonymous visitor. */
  reporterId: string | null;
  /**
   * The reporting SOURCE the database keeps its per-package cap under
   * (security loop r1 M4): `reporterKey()` — an HMAC of the signed-in user, or
   * of the client address for an anonymous visitor. Never the address itself.
   */
  reporterKey?: string | null;
}

/**
 * The one-way source key for the per-(package, reporter) cap: HMAC-SHA256
 * under the server secret of the signed-in user id, else of the client
 * address. 32 hex chars; the database never sees an address or a user id here.
 */
export function reporterKey(who: { userId: string | null; ip: string }, secret: string): string {
  const subject = who.userId ? `user:${who.userId}` : `ip:${who.ip}`;
  return createHmac("sha256", secret).update(`report-source|${subject}`).digest("hex").slice(0, 32);
}

/** The pre-0024 path: insert through the visitor's own session. */
export type DirectInsert = (row: {
  package_id: string;
  reporter_id: string | null;
  reason: string;
}) => PromiseLike<{ error: unknown }>;

export const MAX_REASON_LENGTH = 2000;
/** Mirrors the function's own bound (migration 0024). */
export const MAX_PACKAGE_ID_LENGTH = 200;

/** PostgREST "function not in schema cache" / Postgres "undefined function". */
export function isMissingFunction(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "PGRST202" || code === "42883";
}

export async function fileReport(
  service: RpcClient | null,
  directInsert: DirectInsert,
  input: ReportInput,
): Promise<ReportOutcome> {
  // Server-action arguments are client-controlled: check shape before any call.
  const { packageId } = input;
  if (typeof packageId !== "string" || !packageId || packageId.length > MAX_PACKAGE_ID_LENGTH) return "invalid";
  if (typeof input.reason !== "string" || !input.reason.trim()) return "invalid";
  const reason = input.reason.trim().slice(0, MAX_REASON_LENGTH);
  if (service) {
    // v2 (migration 0025_loop_r1_3) validates first and caps per source; the
    // 0024 function is the fallback while v2 is not applied yet. Only a
    // "function missing" answer moves on to the next door.
    const doors: Array<[string, Record<string, unknown>]> = [
      [
        "file_portal_report_v2",
        {
          p_package_id: packageId,
          p_reason: reason,
          p_reporter_id: input.reporterId,
          p_reporter_key: input.reporterKey ?? null,
        },
      ],
      ["file_portal_report", { p_package_id: packageId, p_reason: reason, p_reporter_id: input.reporterId }],
    ];
    for (const [fn, args] of doors) {
      let result: { data: unknown; error: unknown };
      try {
        result = await service.rpc(fn, args);
      } catch {
        return "error";
      }
      if (!result.error) {
        const s = result.data;
        return s === "ok" || s === "rate_limited" || s === "invalid" ? s : "error";
      }
      if (!isMissingFunction(result.error)) return "error";
    }
  }
  try {
    const { error } = await directInsert({
      package_id: packageId,
      reporter_id: input.reporterId,
      reason,
    });
    return error ? "error" : "ok";
  } catch {
    return "error";
  }
}
