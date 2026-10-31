/**
 * The agent endpoints' pure part (agent-runtime-v3 §4, §11, §14, §15): reading a hand-in, a question digest and an
 * event, with every list bounded and every path checked. No IO. The routes (apps/web /api/agent/*) add the token,
 * the registry and the queue.
 *
 * A hand-in (`POST /api/agent/changesets`):
 *   { changesetId, dependsOn?, files?: [{ path, baseVersion, text } | { path, baseVersion, text: null }
 *                                       | { path, movedFrom, baseVersion }],
 *     appends?: [{ path, baseVersion, append }],   // `.jsonl` records only: text added at the end, never combined
 *     courseOps?: [<course operation>],             // proposals for the owner or deputy, never writes
 *     digest?: { questions: [{ id, text, choices?, recommended? }] } }
 * Figures (binary entries) come in a later step.
 */
import { canWritePath, isRecordsPath, normalizePath, type Role } from "@alembic/package-contract";
import { parseCourseOp, type CourseOp } from "./course-ops";
import type { RowFile } from "./course-committer";

export const HANDIN_LIMITS = {
  /** Files that aren't records, per changeset (§12 M6, §15 M1). */
  contentFiles: 50,
  /** Record entries per changeset. */
  recordFiles: 200,
  /** Text per file. */
  fileBytes: 4 * 1024 * 1024,
  /** Record text in one hand-in (§15 M2). */
  recordBytes: 4 * 1024 * 1024,
  courseOps: 20,
  questions: 50,
  questionText: 500,
  choices: 6,
  choiceText: 120,
  /** Open question items per invoker per course (§14.1, §15 M5). */
  openQuestions: 20,
} as const;

export interface DigestQuestion { id: string; text: string; choices?: string[]; recommended?: string }

export interface HandIn {
  changesetId: string;
  dependsOn: string | null;
  files: RowFile[];
  appends: Array<{ path: string; baseVersion: string; append: string }>;
  courseOps: CourseOp[];
  questions: DigestQuestion[];
  recordBytes: number;
}

const CHANGESET_ID = /^[A-Za-z0-9_-]{8,64}$/;
const VERSION = /^[0-9a-f]{64}$/;
const QID = /^[A-Za-z0-9_.-]{1,64}$/;
const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** One printable line (questions and choices reach a person's screen as plain text). */
const oneLine = (s: string) => !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s);

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Read a hand-in for `invoker` (already capped by the job's rights cap). Paths are normalised and checked as the
 * agent's writes (records: only through the hand-in, never by a person's right).
 */
export function parseHandIn(body: unknown, invoker: Role): ParseResult<HandIn> {
  if (!isObj(body)) return { ok: false, reason: "the hand-in must be a JSON object" };
  const changesetId = body["changesetId"];
  if (typeof changesetId !== "string" || !CHANGESET_ID.test(changesetId)) return { ok: false, reason: "changesetId: 8–64 letters, digits, - or _" };
  const dependsOn = body["dependsOn"] ?? null;
  if (dependsOn !== null && (typeof dependsOn !== "string" || !CHANGESET_ID.test(dependsOn) || dependsOn === changesetId)) return { ok: false, reason: "dependsOn: another changesetId" };

  const seen = new Set<string>();
  const path = (raw: unknown, what: string): string | { error: string } => {
    if (typeof raw !== "string") return { error: `${what}: a path` };
    let p: string;
    try { p = normalizePath(raw); } catch { return { error: `${what}: not a path Alembic accepts` }; }
    if (p !== raw) return { error: `${what}: write the path in its plain form (${p})` };
    return p;
  };
  const writable = (p: string) => isRecordsPath(p) || canWritePath("agent", p, { invoker });

  const files: RowFile[] = [];
  let content = 0, records = 0, recordBytes = 0;
  const rawFiles = body["files"] ?? [];
  if (!Array.isArray(rawFiles)) return { ok: false, reason: "files: a list" };
  for (const [k, f] of rawFiles.entries()) {
    if (!isObj(f)) return { ok: false, reason: `files[${k}]: an object` };
    const p = path(f["path"], `files[${k}].path`);
    if (typeof p !== "string") return { ok: false, reason: p.error };
    if (seen.has(p)) return { ok: false, reason: `${p}: appears twice` };
    seen.add(p);
    if (!writable(p)) return { ok: false, reason: `${p}: the assistant may not change this file` };
    const base = f["baseVersion"] ?? null;
    if (base !== null && (typeof base !== "string" || !VERSION.test(base))) return { ok: false, reason: `${p}: baseVersion is the sha256 of the text read, or null for a new file` };
    if ("movedFrom" in f) {
      const from = path(f["movedFrom"], `files[${k}].movedFrom`);
      if (typeof from !== "string") return { ok: false, reason: from.error };
      if (isRecordsPath(p) || isRecordsPath(from)) return { ok: false, reason: `${p}: records are never moved` };
      if (!writable(from)) return { ok: false, reason: `${from}: the assistant may not move this file` };
      if (seen.has(from)) return { ok: false, reason: `${from}: appears twice` };
      seen.add(from);
      files.push({ path: p, baseVersion: null, text: null, movedFrom: from, baseBlob: null });
    } else {
      const text = f["text"];
      if (text !== null && typeof text !== "string") return { ok: false, reason: `${p}: text is a string, or null to delete` };
      if (typeof text === "string" && bytes(text) > HANDIN_LIMITS.fileBytes) return { ok: false, reason: `${p}: larger than 4 MB` };
      if (text === null && isRecordsPath(p)) return { ok: false, reason: `${p}: records are never deleted` };
      if (text === null && base === null) return { ok: false, reason: `${p}: a delete needs the version that was read` };
      files.push({ path: p, baseVersion: base as string | null, text: text as string | null });
    }
    if (isRecordsPath(p)) { records++; recordBytes += typeof f["text"] === "string" ? bytes(f["text"] as string) : 0; } else content++;
  }

  const appends: HandIn["appends"] = [];
  const rawAppends = body["appends"] ?? [];
  if (!Array.isArray(rawAppends)) return { ok: false, reason: "appends: a list" };
  for (const [k, a] of rawAppends.entries()) {
    if (!isObj(a)) return { ok: false, reason: `appends[${k}]: an object` };
    const p = path(a["path"], `appends[${k}].path`);
    if (typeof p !== "string") return { ok: false, reason: p.error };
    if (!isRecordsPath(p) || !/\.jsonl$/i.test(p)) return { ok: false, reason: `${p}: only .jsonl records are appended to` };
    if (seen.has(p)) return { ok: false, reason: `${p}: appears twice` };
    seen.add(p);
    const base = a["baseVersion"];
    if (typeof base !== "string" || !VERSION.test(base)) return { ok: false, reason: `${p}: baseVersion is the sha256 of the log read` };
    const text = a["append"];
    if (typeof text !== "string" || text === "") return { ok: false, reason: `${p}: append is the text to add` };
    records++;
    recordBytes += bytes(text);
    appends.push({ path: p, baseVersion: base, append: text });
  }
  if (content > HANDIN_LIMITS.contentFiles) return { ok: false, reason: `at most ${HANDIN_LIMITS.contentFiles} files that aren't records per hand-in` };
  if (records > HANDIN_LIMITS.recordFiles) return { ok: false, reason: `at most ${HANDIN_LIMITS.recordFiles} records per hand-in` };
  if (recordBytes > HANDIN_LIMITS.recordBytes) return { ok: false, reason: "at most 4 MB of record text per hand-in" };

  const courseOps: CourseOp[] = [];
  const rawOps = body["courseOps"] ?? [];
  if (!Array.isArray(rawOps) || rawOps.length > HANDIN_LIMITS.courseOps) return { ok: false, reason: `courseOps: a list of at most ${HANDIN_LIMITS.courseOps}` };
  for (const [k, o] of rawOps.entries()) {
    const op = parseCourseOp(o);
    if (!op) return { ok: false, reason: `courseOps[${k}]: not a course operation` };
    courseOps.push(op);
  }

  const q = parseDigest(body["digest"]);
  if (!q.ok) return q;
  if (!files.length && !appends.length && !courseOps.length && !q.value.length) return { ok: false, reason: "the hand-in is empty" };
  return { ok: true, value: { changesetId, dependsOn: dependsOn as string | null, files, appends, courseOps, questions: q.value, recordBytes } };
}

/** A question digest (§14.1, §15 M5): bounded, plain text, unique ids, a recommendation among the choices. */
export function parseDigest(raw: unknown): ParseResult<DigestQuestion[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!isObj(raw) || !Array.isArray(raw["questions"])) return { ok: false, reason: "digest: { questions: [...] }" };
  const list = raw["questions"] as unknown[];
  if (list.length > HANDIN_LIMITS.questions) return { ok: false, reason: `digest: at most ${HANDIN_LIMITS.questions} questions` };
  const out: DigestQuestion[] = [];
  const ids = new Set<string>();
  for (const [k, q] of list.entries()) {
    if (!isObj(q)) return { ok: false, reason: `digest.questions[${k}]: an object` };
    const id = q["id"], text = q["text"], choices = q["choices"], rec = q["recommended"];
    if (typeof id !== "string" || !QID.test(id) || ids.has(id)) return { ok: false, reason: `digest.questions[${k}].id: unique, at most 64 letters, digits, . - _` };
    ids.add(id);
    if (typeof text !== "string" || !text.trim() || text.length > HANDIN_LIMITS.questionText || !oneLine(text.replace(/\n/g, " "))) return { ok: false, reason: `digest.questions[${k}].text: 1–${HANDIN_LIMITS.questionText} characters of plain text` };
    let cs: string[] | undefined;
    if (choices !== undefined) {
      if (!Array.isArray(choices) || choices.length < 2 || choices.length > HANDIN_LIMITS.choices || choices.some((c) => typeof c !== "string" || !c.trim() || c.length > HANDIN_LIMITS.choiceText || !oneLine(c))) {
        return { ok: false, reason: `digest.questions[${k}].choices: 2–${HANDIN_LIMITS.choices} one-line choices of at most ${HANDIN_LIMITS.choiceText} characters` };
      }
      cs = choices as string[];
      if (new Set(cs).size !== cs.length) return { ok: false, reason: `digest.questions[${k}].choices: each choice once` };
    }
    if (rec !== undefined && (typeof rec !== "string" || !cs || !cs.includes(rec))) return { ok: false, reason: `digest.questions[${k}].recommended: one of the choices` };
    out.push({ id, text: text.trim(), ...(cs ? { choices: cs } : {}), ...(typeof rec === "string" ? { recommended: rec } : {}) });
  }
  return { ok: true, value: out };
}

export const EVENT_KINDS = ["message", "tool", "progress", "handover-note"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
const MAX_EVENT_BYTES = 64 * 1024;

/** An event (§4.4). Questions come only in a hand-in's digest (§14.1), so `question` is not an event the agent posts. */
export function parseEvent(raw: unknown): ParseResult<{ kind: EventKind; payload: Record<string, unknown> }> {
  if (!isObj(raw)) return { ok: false, reason: "an event is { kind, payload }" };
  const kind = raw["kind"];
  if (typeof kind !== "string" || !(EVENT_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: `kind: one of ${EVENT_KINDS.join(", ")}` };
  const payload = raw["payload"] ?? {};
  if (!isObj(payload)) return { ok: false, reason: "payload: an object" };
  if (bytes(JSON.stringify(payload)) > MAX_EVENT_BYTES) return { ok: false, reason: "payload: at most 64 KiB" };
  return { ok: true, value: { kind: kind as EventKind, payload } };
}

/** The text a `.jsonl` append writes, when the log is still the version it was read at (else null: stale). */
export function appliedAppend(current: string | null, currentVersion: string | null, a: { baseVersion: string; append: string }): string | null {
  if (current === null || currentVersion !== a.baseVersion) return null;
  const sep = current === "" || current.endsWith("\n") ? "" : "\n";
  return `${current}${sep}${a.append}${a.append.endsWith("\n") ? "" : "\n"}`;
}
