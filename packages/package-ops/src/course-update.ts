/**
 * Bringing a type package's update into a course that was imported from an earlier delivery (owner, 2026-11-02:
 * Coursewerk's notation update for General Chemistry). Pure: the caller reads both folders.
 *
 * - The new delivery is checked exactly as an import is (checksums fail closed; every file checked as a write).
 * - Compared with the delivery the course was imported from: an added or changed file is written with the imported
 *   version as its base, so anything edited in the course since is combined by the version rule, never overwritten;
 *   a file no longer delivered is deleted (records never are).
 * - The chapters must be the same: changing them is a course operation, not a file update.
 * - The course's settings (alembic.json, its statuses) are never taken from a delivery.
 */
import { createHash } from "node:crypto";
import { isRecordsPath } from "@alembic/package-contract";
import { planCourseImport, type ImportInput } from "./course-import";

export interface UpdateChange {
  path: string;
  /** Text to write (null: delete), or the bytes of a figure. */
  text?: string | null;
  bytes?: Uint8Array;
  /** The version imported: sha256 of its text (text files), or its git blob id (figures); null for a new file. */
  baseVersion?: string | null;
  baseBlob?: string | null;
  kind: "add" | "change" | "delete";
}

export type UpdateResult = { ok: true; changes: UpdateChange[]; unchanged: number; leftOut: Array<{ path: string; why: string }>; keptRecords: string[] } | { ok: false; problems: string[] };

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const gitBlob = (b: Uint8Array) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, k) => x === b[k]);

export function planCourseUpdate(i: { delivery: ImportInput["files"]; sums?: string | null; imported: ImportInput["files"]; packageId: string; title?: string }): UpdateResult {
  const next = planCourseImport({ files: i.delivery, sums: i.sums ?? null, packageId: i.packageId, ...(i.title ? { title: i.title } : {}), largeRecords: true });
  if (!next.ok) return next;
  const before = planCourseImport({ files: i.imported, sums: null, packageId: i.packageId, ...(i.title ? { title: i.title } : {}), largeRecords: true });
  if (!before.ok) return { ok: false, problems: ["the delivery the course was imported from can't be read: " + before.problems[0]] };
  const slugs = (m: typeof next.plan.manifest) => m.chapters.map((c) => c.slug).join(",");
  if (slugs(next.plan.manifest) !== slugs(before.plan.manifest)) return { ok: false, problems: ["the chapters differ from the imported delivery: change them with course operations first"] };

  const bytesOf = (f: { text: string } | { bytes: Uint8Array }) => ("text" in f ? new TextEncoder().encode(f.text) : f.bytes);
  const old = new Map(before.plan.files.filter((f) => f.path !== "alembic.json").map((f) => [f.path, f]));
  const changes: UpdateChange[] = [];
  let unchanged = 0;
  for (const f of next.plan.files) {
    if (f.path === "alembic.json") continue;
    const prev = old.get(f.path);
    old.delete(f.path);
    if (prev && same(bytesOf(prev), bytesOf(f))) { unchanged++; continue; }
    const kind = prev ? "change" : "add";
    if ("text" in f) changes.push({ path: f.path, text: f.text, baseVersion: prev && "text" in prev ? sha256(prev.text) : null, kind });
    else changes.push({ path: f.path, bytes: f.bytes, baseBlob: prev && "bytes" in prev ? gitBlob(prev.bytes) : null, kind });
  }
  const keptRecords: string[] = [];
  for (const [path, prev] of old) {
    if (isRecordsPath(path)) { keptRecords.push(path); continue; } // records are never deleted
    if ("text" in prev) changes.push({ path, text: null, baseVersion: sha256(prev.text), kind: "delete" });
    else changes.push({ path, text: null, baseBlob: gitBlob(prev.bytes), kind: "delete" });
  }
  return { ok: true, changes: changes.sort((a, b) => a.path.localeCompare(b.path)), unchanged, leftOut: next.plan.leftOut, keptRecords };
}
