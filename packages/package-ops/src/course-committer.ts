/**
 * The course committer (docs/specs/v3/write-path-v3.md §3, queue-and-jobs-v3
 * §2–§3): the single consumer that turns a course's queue rows into commits
 * on its working repo, in strict order, under a fenced lease.
 *
 * Pure orchestration over two seams — the queue store (Postgres functions of
 * migration 0037) and the working repo (GitHub via @alembic/github-bridge) —
 * so it is tested with fakes and runs unchanged on the worker.
 */

import { canWritePath, type Role } from "@alembic/package-contract";
import { decideFile, type FileDecision, type FileKind } from "./version-rule";

/* -------------------------------------------------------------------------- *
 * Seams
 * -------------------------------------------------------------------------- */

export type RowKind = "sync" | "changeset" | "outside" | "restore" | "system";
export type RowStatus = "done" | "bounced" | "refused" | "failed" | "retry";

export interface QueueRow {
  id: string;
  packageId: string;
  kind: RowKind;
  actorId: string | null;
  invokerId: string | null;
  attempts: number;
  payload: RowPayload;
}

export interface RowFile {
  path: string;
  baseVersion: string | null;
  /** null = delete */
  text: string | null;
}

export interface RowPayload {
  files: RowFile[];
  fromOpenEditor?: boolean;
  /** Paths that already have an open Both-changed item involving another person. */
  openItemsWithOther?: string[];
  summary?: string;
}

export interface QueueStore {
  acquire(packageId: string, holder: string): Promise<string | null>;
  next(packageId: string, holder: string, fence: string): Promise<QueueRow | undefined>;
  finish(input: { id: string; holder: string; fence: string; status: RowStatus; result?: unknown; error?: string; retryAfterSeconds?: number }): Promise<void>;
  /** The actor's role in the course now (re-check at execution). */
  roleOf(packageId: string, userId: string): Promise<Role>;
  /** Text of an earlier version of a file, if Alembic can still find it; undefined = unavailable. */
  baseText(packageId: string, path: string, version: string): Promise<string | null | undefined>;
}

export interface WorkingRepo {
  head(): Promise<string>;
  readFile(ref: string, path: string): Promise<string | null>;
  commitChain(input: { expectedHead: string; steps: Array<{ message: string; files: Array<{ path: string; content: string | null }> }> }): Promise<{ commitShas: string[]; head: string }>;
  recentCommits(limit: number): Promise<Array<{ sha: string; message: string }>>;
}

/** Errors the repo seam may throw, classified by the committer (queue-and-jobs §2.4). */
export class RepoUnavailableError extends Error {
  constructor(readonly kind: "outage" | "access", message: string) {
    super(message);
    this.name = "RepoUnavailableError";
  }
}
export class HeadMoved extends Error {
  constructor() {
    super("head moved");
    this.name = "HeadMoved";
  }
}

/* -------------------------------------------------------------------------- *
 * Helpers
 * -------------------------------------------------------------------------- */

export const MAX_ATTEMPTS = 8;
export const MAX_REDECIDE = 5;
export const TRAILER_SCAN = 50;

export function kindForPath(path: string): FileKind {
  if (path.startsWith("study-guide/")) return "study-guide";
  if (path.startsWith("slides/")) return "slides";
  if (path.startsWith("practice/")) return "practice";
  if (path.startsWith("concepts/")) return "concept-map";
  if (path.startsWith("assessment-support/")) return "assessment-guide";
  if (/\.(png|jpe?g|gif|webp|pdf|zip|mp4|mp3|woff2?)$/i.test(path)) return "binary";
  return "other-text";
}

function trailers(row: QueueRow, extra: Record<string, string> = {}): string {
  const lines: Record<string, string> = {
    "Alembic-Write": row.id,
    "Alembic-Door": row.kind,
    ...(row.actorId ? { "Alembic-Actor": row.actorId } : {}),
    ...(row.invokerId ? { "Alembic-On-Behalf-Of": row.invokerId } : {}),
    ...extra,
  };
  return Object.entries(lines)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function findTrailer(message: string, rowId: string): boolean {
  return message.split("\n").some((l) => l.trim() === `Alembic-Write: ${rowId}`);
}

export interface FileOutcome {
  path: string;
  outcome: FileDecision["outcome"];
  reason?: string;
}

/* -------------------------------------------------------------------------- *
 * Processing one row
 * -------------------------------------------------------------------------- */

export type RowResult =
  | { status: "done"; result: { head: string; commits: string[]; files: FileOutcome[]; recovered?: boolean } }
  | { status: "refused"; reason: string }
  | { status: "retry"; error: string; retryAfterSeconds: number; access?: boolean }
  | { status: "failed"; error: string };

/** Permission re-check at execution (queue-and-jobs §2.5). */
async function permitted(row: QueueRow, store: QueueStore): Promise<string | null> {
  if (row.kind === "outside" || row.kind === "system") return null;
  if (row.kind === "changeset") {
    if (!row.invokerId) return "no invoker";
    const invoker = await store.roleOf(row.packageId, row.invokerId);
    if (invoker === "none") return "the person who asked is no longer a member";
    for (const f of row.payload.files) {
      if (f.path.startsWith("private/coursewerk/")) continue; // harness records: FC-16, checked by the hand-over
      if (!canWritePath("agent", f.path, { invoker })) return `not allowed to change ${f.path}`;
    }
    return null;
  }
  if (!row.actorId) return "no actor";
  const role = await store.roleOf(row.packageId, row.actorId);
  if (role === "none") return "no longer a member of this course";
  for (const f of row.payload.files) if (!canWritePath(role, f.path)) return `not allowed to change ${f.path}`;
  return null;
}

export async function processRow(row: QueueRow, store: QueueStore, repo: WorkingRepo): Promise<RowResult> {
  try {
    // 1. Already landed? (crash after the ref move, or a stale holder.)
    const recent = await repo.recentCommits(TRAILER_SCAN);
    const landed = recent.find((c) => findTrailer(c.message, row.id));
    if (landed) return { status: "done", result: { head: landed.sha, commits: [landed.sha], files: [], recovered: true } };

    // 2. Still allowed?
    const denied = await permitted(row, store);
    if (denied) return { status: "refused", reason: denied };

    for (let round = 0; round < MAX_REDECIDE; round++) {
      const head = await repo.head();
      const decisions: Array<{ file: RowFile; d: FileDecision }> = [];
      for (const file of row.payload.files) {
        const currentText = await repo.readFile(head, file.path);
        const baseText = file.baseVersion === null ? null : await store.baseText(row.packageId, file.path, file.baseVersion);
        const d = await decideFile({
          path: file.path,
          kind: kindForPath(file.path),
          baseVersion: file.baseVersion,
          baseText,
          currentText,
          incomingText: file.text,
          fromOpenEditor: row.kind === "sync" && row.payload.fromOpenEditor === true,
          openItemWithOther: row.payload.openItemsWithOther?.includes(file.path) ?? false,
        });
        if (d.outcome === "refused") return { status: "refused", reason: `${file.path}: ${d.reason}` };
        decisions.push({ file, d });
      }

      // 3. Build the chain: kept versions first (only those not already in history), then the top.
      const kept: Array<{ path: string; content: string | null }> = [];
      const top: Array<{ path: string; content: string | null }> = [];
      for (const { file, d } of decisions) {
        if (d.outcome === "landed") {
          if (!d.noop) top.push({ path: file.path, content: d.write });
        } else if (d.outcome === "combined") {
          top.push({ path: file.path, content: d.write });
        } else if (d.outcome === "both-changed") {
          const currentOnTop = d.top !== file.text;
          if (currentOnTop) {
            // The incoming version is kept: commit it, then restore the current version on top.
            kept.push({ path: file.path, content: d.kept });
            top.push({ path: file.path, content: d.top });
          } else {
            // The incoming version goes on top; the current one is already the head's version.
            top.push({ path: file.path, content: d.top });
          }
        }
      }
      const files: FileOutcome[] = decisions.map(({ file, d }) => ({
        path: file.path,
        outcome: d.outcome,
        ...(d.outcome === "both-changed" ? { reason: d.reason } : {}),
      }));
      if (kept.length === 0 && top.length === 0) return { status: "done", result: { head, commits: [], files } };

      const summary = row.payload.summary ?? `${row.kind} ${row.payload.files.length} file(s)`;
      const steps = [
        ...(kept.length ? [{ message: `Kept version (both changed)\n\n${trailers(row, { "Alembic-Kept": "true" })}`, files: kept }] : []),
        ...(top.length ? [{ message: `${summary}\n\n${trailers(row)}`, files: top }] : []),
      ];
      try {
        const out = await repo.commitChain({ expectedHead: head, steps });
        return { status: "done", result: { head: out.head, commits: out.commitShas, files } };
      } catch (e) {
        if (e instanceof HeadMoved) continue; // decide again on the new head
        throw e;
      }
    }
    return { status: "retry", error: "the course kept changing; trying again shortly", retryAfterSeconds: 30 };
  } catch (e) {
    if (e instanceof RepoUnavailableError) {
      return e.kind === "access"
        ? { status: "retry", error: e.message, retryAfterSeconds: 300, access: true }
        : { status: "retry", error: e.message, retryAfterSeconds: Math.min(900, 60 * 2 ** Math.max(0, row.attempts - 1)) };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (row.attempts >= MAX_ATTEMPTS) return { status: "failed", error: msg };
    return { status: "retry", error: msg, retryAfterSeconds: 60 };
  }
}

/* -------------------------------------------------------------------------- *
 * The loop for one course
 * -------------------------------------------------------------------------- */

/**
 * Drain a course's queue while holding its lease. Returns how many rows were
 * finished; stops when the course has nothing ready, or the lease is lost.
 */
export async function drainCourse(packageId: string, holder: string, store: QueueStore, repo: WorkingRepo, limit = 50): Promise<number> {
  const fence = await store.acquire(packageId, holder);
  if (fence === null) return 0;
  let done = 0;
  for (; done < limit; done++) {
    const row = await store.next(packageId, holder, fence);
    if (!row) break;
    const r = await processRow(row, store, repo);
    if (r.status === "done") await store.finish({ id: row.id, holder, fence, status: "done", result: r.result });
    else if (r.status === "refused") await store.finish({ id: row.id, holder, fence, status: "refused", result: { reason: r.reason } });
    else if (r.status === "failed") await store.finish({ id: row.id, holder, fence, status: "failed", error: r.error });
    else {
      await store.finish({ id: row.id, holder, fence, status: "retry", error: r.error, retryAfterSeconds: r.retryAfterSeconds, ...(r.access ? { result: { needsReconnect: true } } : {}) });
      break; // strict order: the course waits for this row
    }
  }
  return done;
}
