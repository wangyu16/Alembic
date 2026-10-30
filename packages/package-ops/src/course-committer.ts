/**
 * The course committer (docs/specs/v3/write-path-v3.md §3, queue-and-jobs-v3
 * §2–§3): the single consumer that turns a course's queue rows into commits
 * on its working repo, in strict order, under a fenced lease.
 *
 * Pure orchestration over two seams — the queue store (Postgres functions of
 * migration 0037) and the working repo (GitHub via @alembic/github-bridge) —
 * so it is tested with fakes and runs unchanged on the worker.
 */

import { activeProfile, can, canWritePath, fileKind, isSvgPath, mediaProblems, newDocId, normalizePath, svgProblems, unitPartForPath, sha256Hex, WorkingManifestV3Schema, type Role } from "@alembic/package-contract";
import { applyCourseOp, parseCourseOp, type ChapterSnapshot } from "./course-ops";
import { decideFile, type FileDecision, type FileKind } from "./version-rule";

/* -------------------------------------------------------------------------- *
 * Seams
 * -------------------------------------------------------------------------- */

export type RowKind = "sync" | "changeset" | "outside" | "restore" | "system" | "courseop";
export type RowStatus = "done" | "bounced" | "refused" | "failed" | "retry";

export interface QueueRow {
  id: string;
  packageId: string;
  kind: RowKind;
  actorId: string | null;
  invokerId: string | null;
  attempts: number;
  payload: RowPayload;
  /** Times the row was reclaimed while 'processing' (a worker died). */
  abandons?: number;
  /** Commits built for this row by earlier attempts (recorded before their ref move). */
  plannedShas?: string[];
  /** The row waited through an outage/retry of the course before being processed. */
  afterOutage?: boolean;
}

export interface RowFile {
  path: string;
  baseVersion: string | null;
  /** null = delete (unless `blob` or `movedFrom` is set: then null and unused) */
  text: string | null;
  /** Restores (history-v3 §3): the commit the old version is taken from. */
  restoreOf?: string;
  /** A non-text file (contract v3 §11.2): a blob the upload route created and recorded in the ledger. */
  blob?: { sha: string; size: number };
  /** For `blob` and `movedFrom` entries: the blob id the change was made from (null = a new file). */
  baseBlob?: string | null;
  /** A move: this file's content and mode come from `movedFrom` at the head, which is deleted in the same commit. */
  movedFrom?: string;
}

export interface RowPayload {
  files: RowFile[];
  /** System rows only (Door C undo): write each file exactly as given, without the version rule. */
  force?: boolean;
  fromOpenEditor?: boolean;
  /** Paths that already have an open Both-changed item involving another person. */
  openItemsWithOther?: string[];
  summary?: string;
  /** `courseop` rows: the operation and its arguments (contract v3 §13), applied at the head. */
  op?: unknown;
}

export interface QueueStore {
  acquire(packageId: string, holder: string): Promise<string | null>;
  next(packageId: string, holder: string, fence: string): Promise<QueueRow | undefined>;
  finish(input: { id: string; holder: string; fence: string; status: RowStatus; result?: unknown; error?: string; retryAfterSeconds?: number }): Promise<void>;
  /** The actor's role in the course now (re-check at execution). */
  roleOf(packageId: string, userId: string): Promise<Role>;
  /** Text of an earlier version of a file, if Alembic can still find it; undefined = unavailable. */
  baseText(packageId: string, path: string, version: string): Promise<string | null | undefined>;
  /** Is this attempt still the live claim on the row? (Checked right before every ref move.) */
  claimCurrent?(rowId: string, holder: string, fence: string, attempts: number): Promise<boolean>;
  /** Is this blob in the course's upload ledger, recorded for this kind of file? (contract v3 §11.2, K1.10) */
  blobKnown?(packageId: string, sha: string, kind: string): Promise<boolean>;
  /** Record the commits built for this attempt, before the ref moves. */
  recordPlanned?(rowId: string, holder: string, fence: string, attempts: number, shas: string[]): Promise<void>;
}

export interface WorkingRepo {
  head(): Promise<string>;
  readFile(ref: string, path: string): Promise<string | null>;
  /** Every file path at `ref` (needed by course operations). */
  listPaths?(ref: string): Promise<string[]>;
  /** Every file at `ref` with its blob id and mode (non-text files, deletes and moves). */
  treeAt?(ref: string): Promise<Map<string, { sha: string; mode: string }>>;
  /** A blob's bytes (restored figures are checked like uploads). */
  readBlob?(sha: string): Promise<Uint8Array>;
  commitChain(input: {
    expectedHead: string;
    steps: Array<{ message: string; files: Array<ChainEntry> }>;
    /** Called with the built commit SHAs after they exist and before the ref moves; throwing aborts the move. */
    beforeMove?: (shas: string[]) => Promise<void>;
    /** Aborted at the attempt's deadline: the ref must not move (checked again right before the update). */
    signal?: AbortSignal;
  }): Promise<{ commitShas: string[]; head: string }>;
  /** Newest first. `byAlembic` must be true only for commits Alembic itself wrote (its App identity). */
  recentCommits(limit: number): Promise<Array<{ sha: string; message: string; byAlembic?: boolean }>>;
}

/** One file in a commit: text (null = delete) or an existing blob by id. */
export type ChainEntry = { path: string; content: string | null } | { path: string; blobSha: string; mode?: "100644" | "100755" };

/** Errors the repo seam may throw, classified by the committer (queue-and-jobs §2.4). */
export class RepoUnavailableError extends Error {
  constructor(readonly kind: "outage" | "access", message: string) {
    super(message);
    this.name = "RepoUnavailableError";
  }
}
export class AttemptSuperseded extends Error {
  constructor() {
    super("attempt superseded");
    this.name = "AttemptSuperseded";
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

/**
 * Did an earlier attempt of this row land? A commit counts only if it is one
 * this row recorded before its ref move (`plannedShas`), or — for adapters
 * that can prove it — one flagged `byAlembic`. A trailer on a pushed commit
 * proves nothing (G2 finding 4, G2 r2 design risk).
 */
function rowCommits(row: QueueRow, recent: Array<{ sha: string; message: string; byAlembic?: boolean }>) {
  const planned = new Set(row.plannedShas ?? []);
  return recent.filter(
    (c) =>
      planned.has(c.sha) ||
      (c.byAlembic === true && c.message.split("\n").some((l) => l.trim() === `Alembic-Write: ${row.id}`)),
  );
}

const isHeadMoved = (e: unknown) => e instanceof HeadMoved || (e instanceof Error && e.name === "HeadMovedError");

/** The recorded result of a row that already landed: commits and per-file outcomes from its trailers (G2 r2). */
async function alreadyLanded(row: QueueRow, repo: WorkingRepo): Promise<RowResult | null> {
  const recent = await repo.recentCommits(TRAILER_SCAN);
  const mine = rowCommits(row, recent);
  if (mine.length === 0) return null;
  const files: FileOutcome[] = [];
  for (const c of mine) {
    for (const line of c.message.split("\n")) {
      // Only a reason after both-changed; later lines win (the real trailers come last) (G2 r3 LOW).
      const m = /^Alembic-File: (?:(landed|combined)|both-changed ([a-z-]+)) (.+)$/.exec(line.trim());
      if (!m) continue;
      const entry: FileOutcome = m[1] ? { path: m[3]!, outcome: m[1] as FileOutcome["outcome"] } : { path: m[3]!, outcome: "both-changed", reason: m[2]! };
      const i = files.findIndex((f) => f.path === entry.path);
      if (i >= 0) files[i] = entry;
      else files.push(entry);
    }
  }
  return { status: "done", result: { head: mine[0]!.sha, commits: mine.map((c) => c.sha).reverse(), files, recovered: true } };
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
  | { status: "done"; result: { head: string; commits: string[]; files: FileOutcome[]; recovered?: boolean; base?: string } }
  | { status: "refused"; reason: string }
  | { status: "bounced"; reason: string; records: string[] }
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

export interface ProcessOptions {
  /** Format validation for combined texts (e.g. the FC-18 header parses). */
  validate?: (path: string, text: string) => boolean;
  /** Aborted when the attempt's deadline passes: it must not commit afterwards. */
  signal?: AbortSignal;
  /** The claim this attempt runs under (to re-check right before the ref move). */
  claim?: { holder: string; fence: string };
}

/** A row reclaimed this many times without landing is failed. */
export const MAX_ABANDONS = 8;

export async function processRow(row: QueueRow, store: QueueStore, repo: WorkingRepo, opts: ProcessOptions = {}): Promise<RowResult> {
  if (row.kind === "courseop") return processCourseOp(row, store, repo, opts);
  try {
    // 0. Every path must be a clean contract path (no dot segments etc.) and appear once (G2 r1 #8, r2 LOW).
    const paths = row.payload.files.map((f) => f.path);
    for (const p of paths) {
      try {
        normalizePath(p);
      } catch {
        return { status: "refused", reason: `invalid path ${JSON.stringify(p)}` };
      }
    }
    if (new Set(paths).size !== paths.length) return { status: "refused", reason: "the same file appears twice in one change" };

    // 1. Already landed? (crash after the ref move, or a stale holder.)
    const landed = await alreadyLanded(row, repo);
    if (landed) return landed;
    if ((row.abandons ?? 0) >= MAX_ABANDONS) return { status: "failed", error: "abandoned repeatedly while being processed" };

    // 2. Still allowed?
    const denied = await permitted(row, store);
    if (denied) return { status: "refused", reason: denied };

    for (let round = 0; round < MAX_REDECIDE; round++) {
      const head = await repo.head();
      const decisions: Array<{ file: RowFile; d: FileDecision }> = [];
      // Non-text files, moves and deletes (contract v3 §11): decided on the tree, before the text files.
      const special = await decideFilesOnTree(row, store, repo, head);
      if ("refused" in special) return { status: "refused", reason: special.refused };
      for (const file of row.payload.files) {
        if (file.blob || file.movedFrom) continue; // decided above
        const currentText = await repo.readFile(head, file.path);
        // A Door C undo restores exactly the last accepted state; no version rule (system rows only).
        if (row.kind === "system" && row.payload.force === true) {
          decisions.push({ file, d: { outcome: "landed", write: file.text, noop: currentText === file.text } });
          continue;
        }
        // The manifest changes only by compare-and-swap (write-path §4 rule 8, W-10): a system row
        // lands its new manifest only on exactly the version it was made from, and only a valid one.
        if (row.kind === "system" && file.path === "alembic.json") {
          if (file.baseVersion === null || currentText === null || (await sha256Hex(currentText)) !== file.baseVersion) {
            return { status: "refused", reason: "alembic.json: the course settings changed meanwhile; try again" };
          }
          let valid = false;
          try { valid = file.text !== null && WorkingManifestV3Schema.safeParse(JSON.parse(file.text)).success; } catch { /* not JSON */ }
          if (!valid) return { status: "refused", reason: "alembic.json: not a valid course manifest" };
          decisions.push({ file, d: { outcome: "landed", write: file.text, noop: currentText === file.text } });
          continue;
        }
        // A restore (history-v3 §3) is never combined: it lands on the version it was made from, else both are
        // kept with the current version on top (G0r1 B6).
        if (row.kind === "restore") {
          const current = currentText === null ? null : await sha256Hex(currentText);
          if (current === file.baseVersion || currentText === file.text) {
            decisions.push({ file, d: { outcome: "landed", write: file.text, noop: currentText === file.text } });
          } else {
            decisions.push({ file, d: { outcome: "both-changed", top: currentText, kept: file.text, reason: "restore-vs-edit" } });
          }
          continue;
        }
        const baseText = file.baseVersion === null ? null : await store.baseText(row.packageId, file.path, file.baseVersion);
        const d = await decideFile({
          path: file.path,
          kind: kindForPath(file.path),
          baseVersion: file.baseVersion,
          baseText,
          currentText,
          incomingText: file.text,
          // Only on a first attempt that didn't wait through an outage: the editor may be long gone (spec §5, §7).
          fromOpenEditor: row.kind === "sync" && row.payload.fromOpenEditor === true && row.attempts <= 1 && row.afterOutage !== true,
          openItemWithOther: row.payload.openItemsWithOther?.includes(file.path) ?? false,
          allowRecords: row.kind === "changeset" || row.kind === "system",
          ...(opts.validate ? { validate: (t: string) => opts.validate!(file.path, t) } : {}),
        });
        if (d.outcome === "refused") return { status: "refused", reason: `${file.path}: ${d.reason}` };
        decisions.push({ file, d });
      }

      // Harness records land only if every content file landed or was combined (spec §6).
      if (row.kind === "changeset") {
        const records = decisions.filter(({ file }) => file.path.startsWith("private/coursewerk/"));
        const contentOk = decisions.every(({ file, d }) => file.path.startsWith("private/coursewerk/") || d.outcome === "landed" || d.outcome === "combined");
        if (records.length && !contentOk) {
          return { status: "bounced", reason: "some changes need a person first; the records come back to the agent", records: records.map(({ file }) => file.path) };
        }
      }

      // 3. Build the chain: kept versions first (only those not already in history), then the top.
      const kept: ChainEntry[] = [...special.kept];
      const top: ChainEntry[] = [...special.top];
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
      const files: FileOutcome[] = [...special.outcomes, ...decisions.map(({ file, d }) => ({
        path: file.path,
        outcome: d.outcome,
        ...(d.outcome === "both-changed" ? { reason: d.reason } : {}),
      }))];
      if (kept.length === 0 && top.length === 0) {
        const competing = round > 0 ? await alreadyLanded(row, repo) : null; // a competing attempt landed it (G2 r3)
        return competing ?? { status: "done", result: { head, commits: [], files } };
      }

      // One line, no control characters: user text can't forge trailer lines (G2 r3 LOW).
      // History shows this line to teachers: plain words, never the queue's own terms.
      const names = row.payload.files.map((f) => f.path.split("/").pop()).slice(0, 3).join(", ") + (row.payload.files.length > 3 ? ` and ${row.payload.files.length - 3} more` : "");
      const plain = row.kind === "sync" ? `Saved ${names}` : row.kind === "restore" ? `Restored ${names}` : row.kind === "changeset" ? `Changes by the assistant: ${names}` : row.kind === "outside" ? `Changes made on GitHub: ${names}` : `Updated ${names}`;
      const summary = (row.payload.summary ?? plain).replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
      const fileLines = files
        .filter((f) => f.outcome !== "refused")
        .map((f) => `Alembic-File: ${f.outcome}${f.reason ? ` ${f.reason}` : ""} ${f.path}`)
        .join("\n");
      const steps = [
        ...(kept.length ? [{ message: `Kept version (both changed)\n\n${trailers(row, { "Alembic-Kept": "true" })}`, files: kept }] : []),
        ...(top.length ? [{ message: `${summary}\n\n${trailers(row)}\n${fileLines}`, files: top }] : []),
      ];
      // Scan again right before moving the ref: another holder may have landed this row (G2 finding 1).
      const meanwhile = await alreadyLanded(row, repo);
      if (meanwhile) return meanwhile;
      const stillMine = async () => {
        if (opts.signal?.aborted) return false;
        if (opts.claim && store.claimCurrent) return store.claimCurrent(row.id, opts.claim.holder, opts.claim.fence, row.attempts);
        return true;
      };
      if (!(await stillMine())) return { status: "retry", error: "attempt superseded", retryAfterSeconds: 0 };
      try {
        const out = await repo.commitChain({
          expectedHead: head,
          steps,
          // Last gate before the ref moves: record the built commits, and stop if this attempt is no longer the live one (G2 r2 HIGH).
          ...(opts.signal ? { signal: opts.signal } : {}),
          beforeMove: async (shas) => {
            if (!(await stillMine())) throw new AttemptSuperseded();
            if (opts.claim && store.recordPlanned) await store.recordPlanned(row.id, opts.claim.holder, opts.claim.fence, row.attempts, shas);
          },
        });
        return { status: "done", result: { head: out.head, commits: out.commitShas, files, base: head } }; // base: the head it replaced
      } catch (e) {
        if (isHeadMoved(e)) continue; // decide again on the new head (re-scanning first)
        if (e instanceof AttemptSuperseded) return { status: "retry", error: "attempt superseded", retryAfterSeconds: 0 };
        throw e;
      }
    }
    return { status: "retry", error: "the course kept changing; trying again shortly", retryAfterSeconds: 30 };
  } catch (caught) {
    const e = classifyRepoError(caught);
    if (e instanceof RepoUnavailableError) {
      return e.kind === "access"
        ? { status: "retry", error: e.message, retryAfterSeconds: 300, access: true }
        : { status: "retry", error: e.message, retryAfterSeconds: Math.min(900, 60 * 2 ** Math.max(0, row.attempts - 1)) };
    }
    if (e instanceof DeterministicRefusal) {
      // A blob that is no longer on GitHub (contract v3 §11.2): the person still has the file.
      return { status: "refused", reason: row.payload.files.some((f) => f.blob) ? "a file in this change is no longer on GitHub; please add it again" : e.message };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (row.attempts >= MAX_ATTEMPTS) return { status: "failed", error: msg };
    return { status: "retry", error: msg, retryAfterSeconds: 60 };
  }
}

/**
 * Decide the entries the text version rule can't (contract v3 §11.2–§11.6),
 * on the tree at `head`:
 * - a blob reference lands only if the ledger has it with the path's kind;
 *   if the file changed since `baseBlob`, both are kept (the incoming one as a
 *   kept version, the current one on top), never combined;
 * - a move takes the source's blob and mode from the tree and deletes the
 *   source in the same commit; it is refused if the source changed;
 * - a delete or move of a listed chapter's part file is refused (only
 *   removeChapter takes a chapter's parts), as is deleting in private/
 *   without delete.private;
 * - text written to an SVG path must pass the SVG check, and text can't be
 *   written to a picture's path.
 */
async function decideFilesOnTree(row: QueueRow, store: QueueStore, repo: WorkingRepo, head: string): Promise<
  { refused: string } | { kept: ChainEntry[]; top: ChainEntry[]; outcomes: FileOutcome[] }
> {
  const out = { kept: [] as ChainEntry[], top: [] as ChainEntry[], outcomes: [] as FileOutcome[] };
  const restoring = row.kind === "system" && row.payload.force === true; // Door C's undo: what it puts back was accepted before
  for (const f of row.payload.files) {
    if (restoring) break;
    const kind = fileKind(f.path);
    if (!f.blob && !f.movedFrom && f.text !== null) {
      if (kind === null) return { refused: `${f.path}: not a kind of file this course can hold` };
      if (kind !== "text") return { refused: `${f.path}: a picture can't be saved as text` };
      if (isSvgPath(f.path)) {
        const problems = svgProblems(f.text);
        if (problems.length) return { refused: `${f.path}: ${problems[0]}` };
      }
    }
  }
  // The delete rules are for people's changes; Door C's undo and outside rows restore or record what is already so.
  const byPeople = row.kind !== "system" && row.kind !== "outside";
  const touchesTree = row.payload.files.some((f) => f.blob || f.movedFrom || (byPeople && f.text === null));
  if (!touchesTree) return out;
  if (!repo.treeAt) return { refused: "this repository can't list its files" };
  const tree = await repo.treeAt(head);
  // A listed chapter's parts are removed only with the chapter (§11.6).
  let listed: Set<string> | null = null;
  const isListedPart = async (path: string) => {
    const part = unitPartForPath(path);
    if (!part) return false;
    if (!listed) {
      try {
        listed = new Set(WorkingManifestV3Schema.parse(JSON.parse((await repo.readFile(head, "alembic.json")) ?? "null")).chapters.map((c) => c.slug));
      } catch {
        listed = new Set();
      }
    }
    return listed.has(part.slug);
  };
  const role = row.actorId ? await store.roleOf(row.packageId, row.actorId) : null;
  const mayDelete = async (path: string): Promise<string | null> => {
    if (await isListedPart(path)) return `${path}: a chapter's parts are removed with the chapter`;
    if (path.startsWith("private/") && !(role && can(role, "delete.private"))) return `${path}: only the owner or deputy deletes private files`;
    return null;
  };
  for (const f of row.payload.files) {
    if (f.blob && row.kind === "system" && row.payload.force === true) {
      // Door C's undo puts back exactly the blob the course had (it is in the repo's history, not the upload ledger).
      const current = tree.get(f.path);
      if (current?.sha !== f.blob.sha) out.top.push({ path: f.path, blobSha: f.blob.sha, mode: current?.mode === "100755" ? "100755" : "100644" });
      out.outcomes.push({ path: f.path, outcome: "landed" });
    } else if (f.blob) {
      const kind = fileKind(f.path);
      if (!kind || kind === "text") return { refused: `${f.path}: not a kind of file this course can hold` };
      if (row.kind === "restore") {
        // The second source of blobs (history-v3 §3): this path's own blob at the commit restored from, and its
        // bytes pass the same checks as an upload (G0r1 B1).
        if (!f.restoreOf || !repo.readBlob) return { refused: `${f.path}: nothing to restore from` };
        const then = await repo.treeAt(f.restoreOf).catch(() => null);
        if (then?.get(f.path)?.sha !== f.blob.sha) return { refused: `${f.path}: that version isn't in this course's history` };
        const problems = mediaProblems(kind, await repo.readBlob(f.blob.sha));
        if (problems.length) return { refused: `${f.path}: ${problems[0]}` };
      } else if (!store.blobKnown || !(await store.blobKnown(row.packageId, f.blob.sha, kind))) return { refused: `${f.path}: that file wasn't uploaded to this course` };
      const current = tree.get(f.path);
      const base = f.baseBlob ?? null;
      const mode = (current?.mode === "100755" ? "100755" : "100644") as "100644" | "100755";
      if ((current?.sha ?? null) === base || current?.sha === f.blob.sha) {
        if (current?.sha !== f.blob.sha) out.top.push({ path: f.path, blobSha: f.blob.sha, mode });
        out.outcomes.push({ path: f.path, outcome: "landed" });
      } else {
        // Both changed (§11.5): the incoming file as a kept version, the current one stays on top.
        out.kept.push({ path: f.path, blobSha: f.blob.sha, mode });
        out.top.push(current ? { path: f.path, blobSha: current.sha, mode } : { path: f.path, content: null });
        out.outcomes.push({ path: f.path, outcome: "both-changed", reason: "both-changed-file" });
      }
    } else if (f.movedFrom) {
      let from: string;
      try { from = normalizePath(f.movedFrom); } catch { return { refused: `invalid path ${JSON.stringify(f.movedFrom)}` }; }
      if (row.payload.files.some((g) => g.path === from)) return { refused: `${from}: moved and changed in one change` };
      const src = tree.get(from);
      if (!src) return { refused: `${from}: the file to move is no longer there` };
      if ((f.baseBlob ?? null) !== src.sha) return { refused: `${from}: it changed meanwhile; try again` };
      // Same extension, not just the same kind: a text file moved to an SVG name would skip the SVG check (audit r3 LOW-2).
      const ext = (p: string) => (p.split("/").pop() ?? "").toLowerCase().replace(/^[^.]*/, "");
      if (fileKind(from) !== fileKind(f.path) || ext(from) !== ext(f.path)) return { refused: `${f.path}: a move can't change the kind of file` };
      if (tree.has(f.path)) return { refused: `${f.path}: a file is already there` };
      if (role && !canWritePath(role, from)) return { refused: `not allowed to change ${from}` };
      const why = await mayDelete(from);
      if (why) return { refused: why };
      out.top.push({ path: from, content: null }, { path: f.path, blobSha: src.sha, mode: src.mode === "100755" ? "100755" : "100644" });
      out.outcomes.push({ path: f.path, outcome: "landed" });
    } else if (f.text === null && byPeople) {
      const why = await mayDelete(f.path);
      if (why) return { refused: why };
    }
  }
  return out;
}

/** A chapter's manifest entry and part files at an earlier commit (restoreChapter reads the removal's parent). */
async function chapterAt(repo: WorkingRepo, commit: string, slug: string): Promise<ChapterSnapshot | undefined> {
  let text: string | null;
  try {
    text = await repo.readFile(commit, "alembic.json");
  } catch (e) {
    // The head was just readable, so a missing commit means there is nothing to restore, not lost access.
    const status = (e as { status?: unknown })?.status;
    if (status === 404 || status === 422) return undefined;
    throw e;
  }
  let chapter: ChapterSnapshot["chapter"] | undefined;
  try {
    chapter = WorkingManifestV3Schema.parse(JSON.parse(text ?? "null")).chapters.find((c) => c.slug === slug);
  } catch {
    return undefined;
  }
  if (!chapter) return undefined;
  const files: ChapterSnapshot["files"] = [];
  for (const p of activeProfile.unitParts) {
    const content = await repo.readFile(commit, p.path(slug));
    if (content !== null) files.push({ path: p.path(slug), content });
  }
  return { chapter, files };
}

/**
 * A course operation (contract v3 §13.3): re-check the actor's right, then
 * apply the operation to the manifest and file list at the head, commit it,
 * and on a moved head decide again. Operations queued at the same moment
 * therefore land one after another; one that no longer applies is refused
 * with a reason, nothing written.
 */
async function processCourseOp(row: QueueRow, store: QueueStore, repo: WorkingRepo, opts: ProcessOptions): Promise<RowResult> {
  try {
    const op = parseCourseOp(row.payload.op);
    if (!op) return { status: "refused", reason: "not a course operation" };
    const landed = await alreadyLanded(row, repo);
    if (landed) return landed;
    if ((row.abandons ?? 0) >= MAX_ABANDONS) return { status: "failed", error: "abandoned repeatedly while being processed" };
    if (!row.actorId) return { status: "refused", reason: "no actor" };
    const role = await store.roleOf(row.packageId, row.actorId);
    if (op.op === "setLicense" ? !can(role, "license.change") : !can(role, "edit.course-files")) {
      return { status: "refused", reason: op.op === "setLicense" ? "only the owner changes the licence" : "only the owner or deputy changes the course's chapters and details" };
    }
    if (!repo.listPaths) return { status: "failed", error: "this repository can't list files" };
    for (let round = 0; round < MAX_REDECIDE; round++) {
      const head = await repo.head();
      const [manifestText, paths] = await Promise.all([repo.readFile(head, "alembic.json"), repo.listPaths(head)]);
      // What some operations need from the repo: the removed chapter as it was, the current citation file.
      const ctx: Parameters<typeof applyCourseOp>[4] = {};
      if (op.op === "restoreChapter") ctx.snapshot = await chapterAt(repo, op.fromCommit, op.slug);
      if (op.op === "setLicense") ctx.citation = await repo.readFile(head, "CITATION.cff");
      const r = applyCourseOp(manifestText, new Set(paths), op, newDocId, ctx);
      if (!r.ok) return { status: "refused", reason: r.reason };
      const files: FileOutcome[] = r.writes.map((w) => ({ path: w.path, outcome: "landed" as const }));
      const summary = r.summary.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
      const fileLines = files.map((f) => `Alembic-File: landed ${f.path}`).join("\n");
      const meanwhile = await alreadyLanded(row, repo);
      if (meanwhile) return meanwhile;
      const stillMine = async () => {
        if (opts.signal?.aborted) return false;
        if (opts.claim && store.claimCurrent) return store.claimCurrent(row.id, opts.claim.holder, opts.claim.fence, row.attempts);
        return true;
      };
      if (!(await stillMine())) return { status: "retry", error: "attempt superseded", retryAfterSeconds: 0 };
      try {
        const out = await repo.commitChain({
          expectedHead: head,
          steps: [{ message: `${summary}\n\n${trailers(row)}\n${fileLines}`, files: r.writes }],
          ...(opts.signal ? { signal: opts.signal } : {}),
          beforeMove: async (shas) => {
            if (!(await stillMine())) throw new AttemptSuperseded();
            if (opts.claim && store.recordPlanned) await store.recordPlanned(row.id, opts.claim.holder, opts.claim.fence, row.attempts, shas);
          },
        });
        return { status: "done", result: { head: out.head, commits: out.commitShas, files, base: head } }; // base: what a restore reads (§13.4)
      } catch (e) {
        if (isHeadMoved(e)) continue;
        if (e instanceof AttemptSuperseded) return { status: "retry", error: "attempt superseded", retryAfterSeconds: 0 };
        throw e;
      }
    }
    return { status: "retry", error: "the course kept changing; trying again shortly", retryAfterSeconds: 30 };
  } catch (caught) {
    const e = classifyRepoError(caught);
    if (e instanceof RepoUnavailableError) {
      return e.kind === "access"
        ? { status: "retry", error: e.message, retryAfterSeconds: 300, access: true }
        : { status: "retry", error: e.message, retryAfterSeconds: Math.min(900, 60 * 2 ** Math.max(0, row.attempts - 1)) };
    }
    if (e instanceof DeterministicRefusal) return { status: "refused", reason: e.message };
    const msg = e instanceof Error ? e.message : String(e);
    if (row.attempts >= MAX_ATTEMPTS) return { status: "failed", error: msg };
    return { status: "retry", error: msg, retryAfterSeconds: 60 };
  }
}

/**
 * Map a GitHub client error (it carries `status`, and `rateLimited`) onto the
 * queue's classes (queue-and-jobs §2.4): outage (5xx, rate limits, network)
 * → retry; lost access (401, 403 that isn't a rate limit, 404 on the repo)
 * → retry with "Reconnect GitHub"; a 422 that isn't a head move → refused
 * as deterministic. Anything else is returned unchanged.
 */
export function classifyRepoError(e: unknown): unknown {
  if (e instanceof RepoUnavailableError) return e;
  const status = (e as { status?: unknown })?.status;
  const rateLimited = (e as { rateLimited?: unknown })?.rateLimited === true;
  if (typeof status === "number") {
    if (status >= 500 || status === 429 || rateLimited) return new RepoUnavailableError("outage", "GitHub is not responding; trying again shortly");
    if (status === 401 || status === 403 || status === 404) return new RepoUnavailableError("access", "Alembic can't reach this course's repository; the owner needs to reconnect GitHub");
    if (status === 422) return new DeterministicRefusal(`GitHub refused the change (${status})`);
  }
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) return new RepoUnavailableError("outage", "network error; trying again shortly");
  return e;
}

export class DeterministicRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeterministicRefusal";
  }
}

/* -------------------------------------------------------------------------- *
 * The loop for one course
 * -------------------------------------------------------------------------- */

/**
 * Drain a course's queue while holding its lease. Returns how many rows were
 * finished; stops when the course has nothing ready, or the lease is lost.
 */
export const ROW_DEADLINE_MS = 45_000;

export async function drainCourse(packageId: string, holder: string, store: QueueStore, repo: WorkingRepo, limit = 50, opts: ProcessOptions & { deadlineMs?: number } = {}): Promise<number> {
  const fence = await store.acquire(packageId, holder);
  if (fence === null) return 0;
  let done = 0;
  for (; done < limit; done++) {
    // Renew the lease before every row; stop if it was taken over (G2 finding 1).
    if (done > 0 && (await store.acquire(packageId, holder)) !== fence) break;
    const row = await store.next(packageId, holder, fence);
    if (!row) break;
    const deadline = opts.deadlineMs ?? ROW_DEADLINE_MS;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      processRow(row, store, repo, { ...opts, signal: abort.signal, claim: { holder, fence } }),
      new Promise<RowResult>((res) => {
        timer = setTimeout(() => {
          abort.abort(); // the abandoned attempt can no longer move the ref
          res({ status: "retry", error: "took too long; trying again", retryAfterSeconds: 60 });
        }, deadline);
      }),
    ]).finally(() => clearTimeout(timer));
    if (r.status === "done") await store.finish({ id: row.id, holder, fence, status: "done", result: r.result });
    else if (r.status === "refused") await store.finish({ id: row.id, holder, fence, status: "refused", result: { reason: r.reason } });
    else if (r.status === "bounced") await store.finish({ id: row.id, holder, fence, status: "bounced", result: { reason: r.reason, records: r.records } });
    else if (r.status === "failed") await store.finish({ id: row.id, holder, fence, status: "failed", error: r.error });
    else {
      await store.finish({ id: row.id, holder, fence, status: "retry", error: r.error, retryAfterSeconds: r.retryAfterSeconds, ...(r.access ? { result: { needsReconnect: true } } : {}) });
      break; // strict order: the course waits for this row
    }
  }
  return done;
}
