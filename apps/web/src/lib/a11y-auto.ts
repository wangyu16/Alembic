import type { PackageStore } from "@alembic/package-ops";
import { a11yAuditSource, auditPackageA11y, type PublishedReader } from "./a11y-audit";
import type { TrustWriteResult } from "./package-trust-writes";

/**
 * The automatic accessibility check (owner decision 2, 2026-10-24).
 *
 * The badge Discover shows is the server's record of a check of the course's
 * PUBLISHED bytes at the recorded public head (P5.S.3.g/i). Since 0030 any
 * move of that head — every save of a published course — resets it to "not
 * checked", and the only way back was a manual check nobody could reach. Now
 * the check follows the head: after every publish and every public commit
 * Alembic makes (a save, a publish, an absorbed outside change), it is run
 * again, after the response, best-effort.
 *
 * Two parts, both pure apart from what is injected (tested in
 * `a11y-auto.test.ts`; the server wiring is `a11y-auto-server.ts`):
 *
 *  - `runPublishedA11yCheck` — one check: audit the recorded public repository
 *    at its head (the existing `a11yAuditSource` / `auditPackageA11y`, through
 *    the educator's GitHub App installation — a server-held key, so no
 *    browser session or user token is needed), then record the result only
 *    if that head is still the recorded head. Never throws: a check that
 *    cannot run records nothing, so the course simply shows no badge
 *    (Discover treats that as neutral — 0032).
 *  - `A11yAutoScheduler` — the debounce and bounds: at most one check per
 *    course at a time on an instance; saves that land while one runs coalesce
 *    into ONE follow-up run (which reads the newest head); a short settle delay
 *    lets a burst of saves share a run; at most `maxConcurrent` courses are
 *    checked at once per instance; a per-course rate gate (Postgres-counted —
 *    `a11yAuto` in `rate-limit.ts`) bounds the work across instances.
 *
 * Educator wording only in anything shown (CLAUDE.md).
 */

export type CheckedStatus = "pass" | "warn" | "fail";

export type A11yCheckOutcome =
  /** Audited at `headSha` and recorded as the course's current check. */
  | { kind: "recorded"; status: CheckedStatus; errorCount: number; warningCount: number; headSha: string; checkedAt: string }
  /** Audited, but the recorded head moved on meanwhile: nothing recorded (that save's own check records). */
  | { kind: "superseded"; status: CheckedStatus; errorCount: number; warningCount: number; headSha: string }
  /** A trial course: its stored copy is the owner's preview, never the trusted record. */
  | { kind: "trial" }
  /** The published copy could not be read, or the record could not be written. */
  | { kind: "unavailable"; error: string }
  /** The audit itself failed. */
  | { kind: "failed"; error: string };

export interface A11yCheckDeps {
  /** The course record and the base of the read-only published store. */
  store: PackageStore;
  /** Who is asking: the course's owner (a check of someone else's course records nothing). */
  userId: string;
  /** A reader of the published repository (GitHub App installation), or null. */
  connect: () => Promise<PublishedReader | null>;
  /** The guarded record (`packageTrustWriter.recordA11yCheck`). */
  record: (v: { status: CheckedStatus; checkedAt: string; checkedSha: string }) => Promise<TrustWriteResult>;
  now?: () => Date;
}

const statusOf = (errorCount: number, warningCount: number): CheckedStatus =>
  errorCount > 0 ? "fail" : warningCount > 0 ? "warn" : "pass";

/** One automatic check of a published course. Never throws. */
export async function runPublishedA11yCheck(packageId: string, deps: A11yCheckDeps): Promise<A11yCheckOutcome> {
  try {
    const record = await deps.store.getPackage(packageId);
    if (record && record.ownerId !== deps.userId) {
      return { kind: "unavailable", error: "Only the course's owner can record its accessibility check." };
    }
    const source = await a11yAuditSource(deps.store, record, deps.connect);
    if (!source.ok) return { kind: "unavailable", error: source.error };
    if (!source.published) return { kind: "trial" };
    if (!source.headSha) return { kind: "unavailable", error: "This course's published copy couldn't be read." };
    const { errorCount, warningCount } = await auditPackageA11y(source.store, packageId);
    const status = statusOf(errorCount, warningCount);
    const checkedAt = (deps.now?.() ?? new Date()).toISOString();
    const saved = await deps.record({ status, checkedAt, checkedSha: source.headSha });
    if (saved.ok) return { kind: "recorded", status, errorCount, warningCount, headSha: source.headSha, checkedAt };
    if (saved.reason === "not-found") {
      return { kind: "superseded", status, errorCount, warningCount, headSha: source.headSha };
    }
    return { kind: "unavailable", error: "The check ran, but its result couldn't be saved." };
  } catch (err) {
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export interface A11yAutoOptions {
  /** Run a task after the response (`after`); must not block the caller. */
  schedule: (task: () => Promise<void>) => void;
  /** The per-course rate gate (true = may run). A throw counts as "may run". */
  allow?: (packageId: string) => Promise<boolean>;
  /** Courses checked at once on this instance (default 4). */
  maxConcurrent?: number;
  /** Runs per scheduled task: the first plus coalesced follow-ups (default 3). */
  maxRuns?: number;
  /** Wait before the first run so a burst of saves shares it (default 1.5 s). */
  settleMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export type RequestResult = "scheduled" | "coalesced" | "busy";

/** Debounced, bounded scheduling of automatic checks, per course. */
export class A11yAutoScheduler {
  private readonly active = new Map<string, { again: boolean; run: () => Promise<unknown> }>();
  private readonly maxConcurrent: number;
  private readonly maxRuns: number;
  private readonly settleMs: number;

  constructor(private readonly opts: A11yAutoOptions) {
    this.maxConcurrent = opts.maxConcurrent ?? 4;
    this.maxRuns = opts.maxRuns ?? 3;
    this.settleMs = opts.settleMs ?? 1_500;
  }

  /**
   * Ask for a check of `packageId` (`run` performs it, with the newest
   * caller's context). Never throws, never waits for the check.
   *  - "scheduled": a run will start after the response;
   *  - "coalesced": one is already scheduled or running here — it runs once
   *    more when done, reading the newest head;
   *  - "busy": this instance is checking `maxConcurrent` courses already; the
   *    course shows no badge until its next save (neutral in Discover).
   */
  request(packageId: string, run: () => Promise<unknown>): RequestResult {
    const cur = this.active.get(packageId);
    if (cur) {
      cur.again = true;
      cur.run = run;
      return "coalesced";
    }
    if (this.active.size >= this.maxConcurrent) {
      this.opts.log?.(`[a11y-auto] ${packageId}: skipped, ${this.active.size} checks already running`);
      return "busy";
    }
    const entry = { again: true, run };
    this.active.set(packageId, entry);
    try {
      this.opts.schedule(() => this.drain(packageId, entry));
    } catch (err) {
      this.active.delete(packageId);
      this.opts.log?.(`[a11y-auto] ${packageId}: could not schedule: ${err instanceof Error ? err.message : err}`);
      return "busy";
    }
    return "scheduled";
  }

  private async drain(packageId: string, entry: { again: boolean; run: () => Promise<unknown> }): Promise<void> {
    try {
      if (this.settleMs > 0) await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(this.settleMs);
      let runs = 0;
      while (entry.again && runs < this.maxRuns) {
        entry.again = false;
        if (!(await this.allowed(packageId))) {
          this.opts.log?.(`[a11y-auto] ${packageId}: rate bound reached; next save checks again`);
          break;
        }
        runs++;
        try {
          await entry.run();
        } catch (err) {
          this.opts.log?.(`[a11y-auto] ${packageId}: check failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    } finally {
      this.active.delete(packageId);
    }
  }

  private async allowed(packageId: string): Promise<boolean> {
    if (!this.opts.allow) return true;
    try {
      return await this.opts.allow(packageId);
    } catch {
      return true;
    }
  }

  /** Courses with a check scheduled or running (tests, diagnostics). */
  get size(): number {
    return this.active.size;
  }
}
