/**
 * Course operations (package-contract-v3 §13): the only way the course
 * settings (`alembic.json`) change. A queued `courseop` row stores the
 * operation and its arguments; the committer applies it here to the manifest
 * and file list **at the head**, so operations made at the same moment land
 * in order instead of overwriting each other. Pure.
 *
 * Validity is the content profile's (FD-09, FD-10): the manifest schema, the
 * licence list and the tree-aware unit rule.
 */
import { activeProfile, isPage, normalizePath, setStatuses, statusOf, takesStatus, WorkingManifestV3Schema, type StatusChange, type WorkingManifestV3 } from "@alembic/package-contract";
import { addChapters, chapterPartPath, chapterPartText, CHAPTER_PARTS } from "./chapter-parts";
import { licenseFileContent } from "./license-file";

export type CourseOp =
  | { op: "addChapters"; titles: string[]; startParts: boolean }
  | { op: "renameChapter"; slug: string; title: string }
  | { op: "moveChapter"; slug: string; toIndex: number }
  | { op: "removeChapter"; slug: string }
  | { op: "setChapterMode"; slug: string; mode: "draft" | "package" }
  | { op: "setCourseDetails"; title?: string; description?: string; audience?: string } // `level`: D-126 item 8
  | { op: "setLicense"; license: string }
  | { op: "restoreChapter"; slug: string; fromCommit: string }
  /** Files' status (family SITE-TYPE-CONTRACT §7), many at once: mark pages draft or completed; take files off the website or bring them back. */
  | { op: "setStatus"; paths: string[]; status: StatusChange }
  /** A course option (owner/deputy): `editReturnsToDraft` — a saved edit to a completed page makes it a draft again. */
  | { op: "setOption"; option: "editReturnsToDraft"; value: boolean };

/** The most files one status change may name (a whole course at once). */
export const MAX_STATUS_PATHS = 1000;

/** What restoreChapter brings back: the chapter's entry and its part files as they were at `fromCommit` (read by the committer). */
export interface ChapterSnapshot {
  chapter: { slug: string; title: string; mode: "draft" | "package" };
  files: Array<{ path: string; content: string }>;
}

export const COURSE_OPS = ["addChapters", "renameChapter", "moveChapter", "removeChapter", "setChapterMode", "setCourseDetails", "setLicense", "restoreChapter"] as const;

export type CourseOpResult =
  | { ok: true; manifest: WorkingManifestV3; writes: Array<{ path: string; content: string | null }>; summary: string }
  | { ok: false; reason: string };

const oneLine = (t: unknown, max: number) => (typeof t === "string" ? t.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Check an operation's shape (it arrives as JSON from a client). */
export function parseCourseOp(raw: unknown): CourseOp | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slugOk = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 60;
  switch (r.op) {
    case "addChapters":
      return Array.isArray(r.titles) && r.titles.length <= 200 && r.titles.every((t) => typeof t === "string" && t.length <= 1000) && typeof r.startParts === "boolean"
        ? { op: "addChapters", titles: r.titles as string[], startParts: r.startParts } : null;
    case "renameChapter":
      return slugOk(r.slug) && oneLine(r.title, 200) ? { op: "renameChapter", slug: r.slug, title: oneLine(r.title, 200) } : null;
    case "moveChapter":
      return slugOk(r.slug) && Number.isInteger(r.toIndex) && (r.toIndex as number) >= 0 ? { op: "moveChapter", slug: r.slug, toIndex: r.toIndex as number } : null;
    case "removeChapter":
      return slugOk(r.slug) ? { op: "removeChapter", slug: r.slug } : null;
    case "setChapterMode":
      return slugOk(r.slug) && (r.mode === "draft" || r.mode === "package") ? { op: "setChapterMode", slug: r.slug, mode: r.mode } : null;
    case "setCourseDetails": {
      const out: CourseOp = { op: "setCourseDetails" };
      for (const k of ["title", "description", "audience"] as const) {
        if (r[k] === undefined) continue;
        if (typeof r[k] !== "string") return null;
        out[k] = k === "description" ? String(r[k]).trim().slice(0, 2000) : oneLine(r[k], 200);
      }
      return Object.keys(out).length > 1 ? out : null;
    }
    case "setLicense":
      return typeof r.license === "string" && activeProfile.licences.allowed.includes(r.license) ? { op: "setLicense", license: r.license } : null;
    case "setStatus": {
      if (!Array.isArray(r.paths) || r.paths.length === 0 || r.paths.length > MAX_STATUS_PATHS) return null;
      if (r.status !== "draft" && r.status !== "completed" && r.status !== "withdrawn" && r.status !== "public") return null;
      const paths: string[] = [];
      for (const p of r.paths) {
        if (typeof p !== "string") return null;
        try { paths.push(normalizePath(p)); } catch { return null; }
      }
      return { op: "setStatus", paths: [...new Set(paths)], status: r.status };
    }
    case "setOption":
      return r.option === "editReturnsToDraft" && typeof r.value === "boolean" ? { op: "setOption", option: r.option, value: r.value } : null;
    case "restoreChapter":
      return slugOk(r.slug) && typeof r.fromCommit === "string" && /^[0-9a-f]{40}$/.test(r.fromCommit) ? { op: "restoreChapter", slug: r.slug, fromCommit: r.fromCommit } : null;
    default:
      return null;
  }
}

/** Plain words for history and the queue's summary. */
function describe(op: CourseOp, m: WorkingManifestV3): string {
  const title = (slug: string) => m.chapters.find((c) => c.slug === slug)?.title ?? slug;
  switch (op.op) {
    case "addChapters": return op.titles.filter((t) => t.trim()).length === 1 ? `Added chapter “${oneLine(op.titles.find((t) => t.trim()), 120)}”` : "Added chapters";
    case "renameChapter": return `Renamed chapter “${title(op.slug)}” to “${op.title}”`;
    case "moveChapter": return `Moved chapter “${title(op.slug)}”`;
    case "removeChapter": return `Removed chapter “${title(op.slug)}”`;
    case "setChapterMode": return `Chapter “${title(op.slug)}” ${op.mode === "draft" ? "back to draft" : "ready for publishing"}`;
    case "setCourseDetails": return "Changed the course details";
    case "setLicense": return `Changed the licence to ${op.license}`;
    case "restoreChapter": return `Restored chapter “${op.slug}”`;
    case "setOption": return op.value ? "An edit now returns a completed page to draft" : "An edit no longer changes a page's status";
    case "setStatus": {
      const what = op.paths.length === 1 ? (op.paths[0]!.split("/").pop() ?? op.paths[0]!) : `${op.paths.length} files`;
      return op.status === "completed" ? `Marked ${what} completed` : op.status === "draft" ? `Marked ${what} draft` : op.status === "withdrawn" ? `Took ${what} off the website` : `Brought ${what} back to the website`;
    }
  }
}

/**
 * Apply `op` to the manifest text and the file list at the head. `newUid`
 * mints document ids for started parts. Refuses (nothing written) when the
 * operation no longer applies or the result isn't valid under the profile.
 */
export function applyCourseOp(manifestText: string | null, paths: ReadonlySet<string>, op: CourseOp, newUid: () => string, ctx: { snapshot?: ChapterSnapshot; citation?: string | null } = {}): CourseOpResult {
  let m: WorkingManifestV3;
  try {
    m = WorkingManifestV3Schema.parse(JSON.parse(manifestText ?? "null"));
  } catch {
    return { ok: false, reason: "the course settings can't be read" };
  }
  const summary = describe(op, m);
  const has = (slug: string) => m.chapters.some((c) => c.slug === slug);
  const writes: Array<{ path: string; content: string | null }> = [];
  let next: WorkingManifestV3;
  switch (op.op) {
    case "addChapters": {
      let r: ReturnType<typeof addChapters>;
      try {
        r = addChapters(m, op.titles);
      } catch (e) {
        return { ok: false, reason: e instanceof RangeError ? e.message : "the chapters can't be added" };
      }
      if (!r.added.length) return { ok: false, reason: "no chapter title given" };
      next = r.manifest;
      for (const ch of r.added) {
        for (const { part } of CHAPTER_PARTS) {
          const path = chapterPartPath(part, ch.slug);
          // Without startParts each chapter starts with the parts the profile requires (its study guide).
          if ((op.startParts || activeProfile.requiredParts.includes(part)) && !paths.has(path)) writes.push({ path, content: chapterPartText(part, ch.title, newUid()) });
        }
      }
      break;
    }
    case "renameChapter":
      if (!has(op.slug)) return { ok: false, reason: "that chapter is no longer in the course" };
      next = { ...m, chapters: m.chapters.map((c) => (c.slug === op.slug ? { ...c, title: op.title } : c)) };
      break;
    case "moveChapter": {
      if (!has(op.slug)) return { ok: false, reason: "that chapter is no longer in the course" };
      const rest = m.chapters.filter((c) => c.slug !== op.slug);
      const ch = m.chapters.find((c) => c.slug === op.slug)!;
      const at = Math.min(op.toIndex, rest.length);
      next = { ...m, chapters: [...rest.slice(0, at), ch, ...rest.slice(at)] };
      break;
    }
    case "removeChapter":
      if (!has(op.slug)) return { ok: false, reason: "that chapter is no longer in the course" };
      next = { ...m, chapters: m.chapters.filter((c) => c.slug !== op.slug) };
      // Its parts go with it, at their current versions (§13.4); history keeps them for restoreChapter.
      for (const { part } of CHAPTER_PARTS) {
        const path = chapterPartPath(part, op.slug);
        if (paths.has(path)) writes.push({ path, content: null });
      }
      break;
    case "setChapterMode":
      if (!has(op.slug)) return { ok: false, reason: "that chapter is no longer in the course" };
      next = { ...m, chapters: m.chapters.map((c) => (c.slug === op.slug ? { ...c, mode: op.mode } : c)) };
      break;
    case "setCourseDetails": {
      const { op: _op, ...fields } = op;
      next = { ...m, ...fields } as WorkingManifestV3;
      break;
    }
    case "setLicense": {
      // The licence files follow in the same commit (contract v3 §13.1, K1.18): LICENSE regenerated; an existing
      // CITATION.cff keeps everything but its licence line (it is written with author data this module doesn't have).
      next = { ...m, license: op.license as WorkingManifestV3["license"] };
      writes.push({ path: "LICENSE", content: licenseFileContent(next.license) });
      if (ctx.citation != null) {
        const lines = ctx.citation.split("\n").filter((l) => !/^license:/.test(l));
        if (activeProfile.licences.open.includes(op.license)) lines.splice(Math.max(1, lines.findIndex((l) => /^title:/.test(l)) + 1), 0, `license: ${op.license}`);
        writes.push({ path: "CITATION.cff", content: lines.join("\n") });
      }
      break;
    }
    case "setOption": {
      next = { ...m, options: { ...(m.options ?? {}), [op.option]: op.value } };
      break;
    }
    case "setStatus": {
      // Clearing a status (draft, bring back) may name a file that is gone (Door C drops the status of a file deleted on
      // GitHub). Otherwise a page deleted since the person looked is skipped, not a reason to refuse the rest.
      const clearing = op.status === "draft" || op.status === "public";
      const present = clearing ? op.paths.filter((p) => paths.has(p) || m.status?.[p] !== undefined) : op.paths.filter((p) => paths.has(p));
      if (!present.length) return { ok: false, reason: op.paths.length === 1 ? `${op.paths[0]!.split("/").pop()} is no longer in the course` : "those pages are no longer in the course" };
      for (const p of present.filter((x) => paths.has(x))) {
        if (!takesStatus(p)) return { ok: false, reason: `${p.split("/").pop()} is instructor-only and never published` };
        if ((op.status === "draft" || op.status === "completed") && !isPage(p)) return { ok: false, reason: `${p.split("/").pop()} isn't a page; take it off the website instead` };
      }
      const status = setStatuses(m.status, present, op.status);
      next = { ...m, status };
      if (Object.keys(status).length === 0) delete (next as { status?: unknown }).status;
      break;
    }
    case "restoreChapter": {
      const snap = ctx.snapshot;
      if (!snap || snap.chapter.slug !== op.slug) return { ok: false, reason: "that chapter can't be found where it was removed" };
      // Its slug may have been reused by a newer chapter meanwhile: then it comes back under a free one (§13.4).
      let slug = op.slug;
      let title = snap.chapter.title;
      if (has(slug)) {
        for (let n = 1; has(slug); n++) slug = n === 1 ? `${op.slug}-restored` : `${op.slug}-restored-${n}`;
        title = `${title} (restored)`;
      }
      next = { ...m, chapters: [...m.chapters, { slug, title, mode: snap.chapter.mode }] };
      for (const f of snap.files) {
        const hit = activeProfile.unitParts.find((p) => p.path(op.slug) === f.path);
        if (!hit) continue;
        const path = hit.path(slug);
        if (!paths.has(path)) writes.push({ path, content: f.content });
      }
      // A part it never had but the profile now requires is started, as for a new chapter.
      for (const p of activeProfile.unitParts) {
        const path = p.path(slug);
        if (activeProfile.requiredParts.includes(p.id) && !paths.has(path) && !writes.some((w) => w.path === path)) writes.push({ path, content: p.starter(title, newUid()) });
      }
      break;
    }
  }
  // Validity (the profile's): the schema, the licence list, and every listed chapter has its required parts.
  const parsed = WorkingManifestV3Schema.safeParse(next);
  if (!parsed.success) return { ok: false, reason: "the result isn't a valid course" };
  if (!activeProfile.licences.allowed.includes(parsed.data.license)) return { ok: false, reason: "the course's licence isn't allowed" };
  const after = new Set(paths);
  for (const w of writes) (w.content === null ? after.delete(w.path) : after.add(w.path));
  // Only problems this operation would introduce: a course that already breaks a rule can still be changed (and mended).
  // Problems are compared under the new titles, so renaming a chapter that already lacks a part isn't a new problem.
  const hadSlug = new Set(m.chapters.map((c) => c.slug));
  const before = new Set(activeProfile.unitProblems(parsed.data.chapters.filter((c) => hadSlug.has(c.slug)), paths));
  const introduced = activeProfile.unitProblems(parsed.data.chapters, after).filter((p) => !before.has(p));
  if (introduced.length) return { ok: false, reason: introduced[0]! };
  writes.unshift({ path: "alembic.json", content: `${JSON.stringify(parsed.data, null, 2)}\n` });
  return { ok: true, manifest: parsed.data, writes, summary };
}
