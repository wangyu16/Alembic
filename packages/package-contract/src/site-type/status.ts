/**
 * A file's status (family docs/SITE-TYPE-CONTRACT.md §7): pages are draft or
 * completed, the person's explicit choice; any public file can be withdrawn
 * (taken off the website). Statuses live in alembic.json under `status`
 * (path → "completed" | "withdrawn"); a page not listed is a draft, any
 * other file not listed is published as it is. Pure.
 */
import { DEFAULT_SITE_TYPE, siteType } from "./index";

export type FileStatus = "draft" | "completed" | "withdrawn" | "public";
export type StatusMap = Readonly<Record<string, "completed" | "withdrawn">>;

/** Folders whose files take no status: the default site type's public records, published as they are. Read lazily (index imports this file). */
let noStatus: string[] | undefined;
const NO_STATUS = { some: (f: (p: string) => boolean) => (noStatus ??= recordsPublic()).some(f) };
function recordsPublic(): string[] {
  const def = siteType(DEFAULT_SITE_TYPE).definition;
  return def.records ? [`${def.records.public.replace(/\/$/, "")}/`] : [];
}

/** A page: a file Alembic renders (`.md`, `.slides.md`, `.paged.md`) outside private/ and the records. */
export function isPage(path: string): boolean {
  return /\.md$/i.test(path) && !path.startsWith("private/") && !NO_STATUS.some((p) => path.startsWith(p)) && path !== "alembic.json";
}

/** May this file have a status at all (public, not Alembic's own)? */
export function takesStatus(path: string): boolean {
  return !path.startsWith("private/") && path !== "alembic.json" && !path.startsWith(".") && !path.includes("/.");
}

/** A file's status: draft or completed for a page, public for any other file; withdrawn for either. */
export function statusOf(map: StatusMap | undefined, path: string): FileStatus {
  const s = map?.[path];
  if (s === "withdrawn") return "withdrawn";
  if (isPage(path)) return s === "completed" ? "completed" : "draft";
  return "public";
}

/**
 * The status map after files move, are deleted or come back (§7 "A status
 * follows its file"). Returns null when nothing changes.
 * - a move carries the status (dropped if the file moves into private/);
 * - a delete drops it;
 * - a restored file gets back the status it had (`restored[].status`).
 */
export function followFiles(
  map: StatusMap | undefined,
  changes: { moves?: ReadonlyArray<{ from: string; to: string }>; deletes?: readonly string[]; restored?: ReadonlyArray<{ path: string; status: "completed" | "withdrawn" | undefined }> },
): Record<string, "completed" | "withdrawn"> | null {
  const next: Record<string, "completed" | "withdrawn"> = { ...(map ?? {}) };
  let changed = false;
  for (const { from, to } of changes.moves ?? []) {
    const s = next[from];
    if (s === undefined) continue;
    delete next[from];
    if (takesStatus(to)) next[to] = s;
    changed = true;
  }
  for (const p of changes.deletes ?? []) {
    if (next[p] !== undefined) { delete next[p]; changed = true; }
  }
  for (const { path, status } of changes.restored ?? []) {
    if (status === undefined || next[path] === status || !takesStatus(path)) continue;
    next[path] = status;
    changed = true;
  }
  return changed ? next : null;
}

export type StatusChange = "draft" | "completed" | "withdrawn" | "public";

/**
 * Apply a person's status change to many files at once. `withdrawn` and
 * `public` (bring back) are the lead's; `draft` and `completed` are for pages
 * and, while a file is withdrawn, the lead's too (§6, §7).
 */
export function setStatuses(map: StatusMap | undefined, paths: readonly string[], to: StatusChange): Record<string, "completed" | "withdrawn"> {
  const next: Record<string, "completed" | "withdrawn"> = { ...(map ?? {}) };
  for (const p of paths) {
    if (to === "completed") next[p] = "completed";
    else if (to === "withdrawn") next[p] = "withdrawn";
    else delete next[p]; // draft, or brought back: a page becomes a draft, any other file public again
  }
  return next;
}
