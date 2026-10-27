/**
 * The version rule (docs/specs/v3/write-path-v3.md §4–§5): what happens when
 * a change arrives for one file. Pure — the course committer supplies the
 * three texts (base, current at the working-repo head, incoming) and acts on
 * the decision.
 *
 * Block splitting (A5) is interim until orz-markdown exports `splitBlocks`
 * (request K3): study guides split at H2 headings outside code fences (the
 * same boundaries as `@alembic/package-contract` block-source); every other
 * kind is one block, so any concurrent change to it becomes "both changed".
 */

import { sha256Hex } from "@alembic/package-contract";

/* -------------------------------------------------------------------------- *
 * Blocks
 * -------------------------------------------------------------------------- */

export type FileKind = "study-guide" | "slides" | "practice" | "concept-map" | "assessment-guide" | "other-text" | "binary";

/** Split into segments that concatenate back to the exact input. */
export function splitBlocks(text: string, kind: FileKind): string[] {
  if (kind !== "study-guide") return text === "" ? [] : [text];
  const lines = text.split(/(?<=\n)/); // keep line endings
  const out: string[] = [];
  let cur = "";
  let fence: string | null = null;
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, "");
    const f = /^(```|~~~)/.exec(bare);
    if (f) {
      if (fence === null) fence = f[1]!;
      else if (bare.startsWith(fence)) fence = null;
    }
    if (fence === null && !f && /^##\s+\S/.test(bare) && cur !== "") {
      out.push(cur);
      cur = "";
    }
    cur += line;
  }
  if (cur !== "") out.push(cur);
  return out;
}

/* -------------------------------------------------------------------------- *
 * Three-way merge over block sequences (diff3 with atomic blocks)
 * -------------------------------------------------------------------------- */

interface Hunk {
  /** Base range [start, end) replaced by `with`. start === end is an insertion at `start`. */
  start: number;
  end: number;
  with: string[];
}

/** Hunks turning `base` into `other`, from a longest-common-subsequence alignment. */
function hunks(base: string[], other: string[]): Hunk[] {
  const n = base.length;
  const m = other.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = base[i] === other[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const flush = () => {
    if (open) out.push(open);
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === other[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      open ??= { start: i, end: i, with: [] };
      open.with.push(other[j]!);
      j++;
    } else {
      open ??= { start: i, end: i, with: [] };
      open.end = i + 1;
      i++;
    }
  }
  flush();
  // A one-for-one replacement of k blocks is k independent block edits:
  // split it, so an identical edit resent alongside a new one is recognised
  // block by block (G2 finding 2).
  return out.flatMap((hk) =>
    hk.end - hk.start === hk.with.length && hk.with.length > 1
      ? hk.with.map((w, k) => ({ start: hk.start + k, end: hk.start + k + 1, with: [w] }))
      : [hk],
  );
}

/**
 * Two hunks conflict if their base ranges overlap, or if both insert at the
 * same base position, or one inserts at a position the other replaces or
 * borders (an insertion next to an edit is ambiguous: refuse to guess).
 */
function conflicts(a: Hunk, b: Hunk): boolean {
  const aIns = a.start === a.end;
  const bIns = b.start === b.end;
  if (aIns && bIns) return a.start === b.start;
  if (aIns) return a.start >= b.start && a.start <= b.end;
  if (bIns) return b.start >= a.start && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}

/** Combine two edits of `base`; null if they touch the same block. */
export function mergeBlocks(base: string[], current: string[], incoming: string[]): string[] | null {
  const hc = hunks(base, current);
  const same = (x: Hunk, y: Hunk) => x.start === y.start && x.end === y.end && x.with.length === y.with.length && x.with.every((w, k) => w === y.with[k]);
  // The same change made on both sides (a resent edit) is not a conflict (G2 finding 2).
  const hi = hunks(base, incoming).filter((y) => !hc.some((x) => same(x, y)));
  for (const a of hc) for (const b of hi) if (conflicts(a, b)) return null;
  const all = [...hc.map((h) => ({ ...h, side: 0 })), ...hi.map((h) => ({ ...h, side: 1 }))].sort(
    (x, y) => x.start - y.start || x.end - y.end || x.side - y.side,
  );
  const out: string[] = [];
  let pos = 0;
  for (const h of all) {
    while (pos < h.start) out.push(base[pos++]!);
    out.push(...h.with);
    pos = Math.max(pos, h.end);
  }
  while (pos < base.length) out.push(base[pos++]!);
  return out;
}

/* -------------------------------------------------------------------------- *
 * The decision
 * -------------------------------------------------------------------------- */

export interface FileChangeInput {
  path: string;
  kind: FileKind;
  /** sha256 of the version the change started from; null = new file. */
  baseVersion: string | null;
  /** Text of that version, if Alembic still has it; undefined = unavailable. */
  baseText?: string | null;
  /** Text at the working-repo head; null = the file does not exist there. */
  currentText: string | null;
  /** The incoming text; null = delete. */
  incomingText: string | null;
  /** A sync from an open editor (Door A). */
  fromOpenEditor: boolean;
  /** The document already has an open Both-changed item involving another person. */
  openItemWithOther?: boolean;
  /** Optional format validation for a combined text (e.g. FC-18 header parse). */
  validate?: (text: string) => boolean;
  /** Coursewerk records may be written (harness changesets and system rows only). */
  allowRecords?: boolean;
}

export type FileDecision =
  | { outcome: "landed"; write: string | null; noop: boolean }
  | { outcome: "combined"; write: string }
  /** Both kept: `top` is written as the head version, `kept` is committed before it. */
  | { outcome: "both-changed"; top: string | null; kept: string | null; reason: BothReason }
  | { outcome: "refused"; reason: "records-not-editable" | "manifest-not-editable" };

export type BothReason =
  | "same-block"
  | "base-unavailable"
  | "plan-file"
  | "binary"
  | "delete-vs-edit"
  | "edit-vs-delete"
  | "create-exists"
  | "invalid-combination";

const PLAN_KINDS: readonly FileKind[] = ["concept-map", "assessment-guide"];

const v = async (t: string | null): Promise<string | null> => (t === null ? null : sha256Hex(t));

/** Apply the version rule to one file. */
export async function decideFile(c: FileChangeInput): Promise<FileDecision> {
  if (c.path.startsWith("private/coursewerk/") && !c.allowRecords) return { outcome: "refused", reason: "records-not-editable" };
  if (c.path === "alembic.json") return { outcome: "refused", reason: "manifest-not-editable" };

  const current = await v(c.currentText);
  const incoming = await v(c.incomingText);

  // Rule 0: the head already holds exactly the incoming content (a replay).
  if (incoming === current) return { outcome: "landed", write: c.incomingText, noop: true };
  // Rule 1: started from the current version.
  if (c.baseVersion === current) return { outcome: "landed", write: c.incomingText, noop: false };

  // From here on, someone else changed the file since `base`.
  const typistOnTop = c.fromOpenEditor && !c.openItemWithOther;
  const both = (reason: BothReason, allowTypist = true): FileDecision =>
    allowTypist && typistOnTop
      ? { outcome: "both-changed", top: c.incomingText, kept: c.currentText, reason }
      : { outcome: "both-changed", top: c.currentText, kept: c.incomingText, reason };

  // Rule 3: deletes and creates.
  if (c.incomingText === null) return both("delete-vs-edit", false); // a delete never wins over an edit
  if (c.currentText === null) return both("edit-vs-delete", false); // the edit is kept; restoring it is offered
  if (c.baseVersion === null) return both("create-exists");

  // Rule 4: course-plan files never combine, and current always stays on top.
  if (PLAN_KINDS.includes(c.kind)) return both("plan-file", false);
  // Rule 6: binary files never combine.
  if (c.kind === "binary") return both("binary");
  // Rule 2: no base text, no combination.
  if (c.baseText === undefined || c.baseText === null || (await sha256Hex(c.baseText)) !== c.baseVersion) return both("base-unavailable");

  // Rule 5: combine at block level.
  const merged = mergeBlocks(splitBlocks(c.baseText, c.kind), splitBlocks(c.currentText, c.kind), splitBlocks(c.incomingText, c.kind));
  if (merged === null) return both("same-block");
  const text = merged.join("");
  if (c.validate && !c.validate(text)) return both("invalid-combination");
  return { outcome: "combined", write: text };
}
