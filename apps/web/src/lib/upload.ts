/**
 * Uploading a figure or other non-text file (package-contract-v3 §11.2–§11.4):
 * the checks before anything reaches GitHub. Pure, so the route stays thin.
 */
import { canWritePath, fileKind, MAX_UPLOAD_BYTES, mediaProblems, normalizePath, type MediaKind, type Role } from "@alembic/package-contract";

/** Uploads one person may make per hour, and one course may take per hour (each is one GitHub call on the owner's installation). */
export const UPLOADS_PER_PERSON_HOUR = 60;
export const UPLOADS_PER_COURSE_HOUR = 200;
/** The course's uploaded files in total (every blob created, committed or not): a warning, then a refusal. */
export const COURSE_WARN_BYTES = 500_000_000;
export const COURSE_MAX_BYTES = 1_000_000_000;

export interface UploadCounts { byPersonLastHour: number; byCourseLastHour: number; courseBytes: number }

export type UploadCheck = { ok: true; path: string; kind: MediaKind } | { ok: false; status: number; message: string };

export function checkUpload(i: { path: string; size: number; role: Role; counts: UploadCounts; fromDoc?: string }): UploadCheck {
  let path: string;
  try {
    path = normalizePath(i.path);
  } catch {
    return { ok: false, status: 400, message: "That file name can't be used." };
  }
  // A private document's figures stay private (round 1 audit H2).
  if (i.fromDoc?.startsWith("private/") && !path.startsWith("private/")) return { ok: false, status: 403, message: "A figure for an instructor-only document stays instructor-only." };
  const kind = fileKind(path);
  if (!kind || kind === "text") return { ok: false, status: 415, message: "This kind of file can't be added to a course (pictures: PNG, JPEG, GIF, WebP, SVG)." };
  if (!canWritePath(i.role, path)) return { ok: false, status: 403, message: "You can't add files there." };
  if (i.size <= 0) return { ok: false, status: 400, message: "The file is empty." };
  if (i.size > MAX_UPLOAD_BYTES) return { ok: false, status: 413, message: "The file is larger than 4 MB. Make it smaller (for example, save the picture at a lower resolution) and try again." };
  if (i.counts.byPersonLastHour >= UPLOADS_PER_PERSON_HOUR) return { ok: false, status: 429, message: "You've added many files in the last hour. Please wait a little and try again." };
  if (i.counts.byCourseLastHour >= UPLOADS_PER_COURSE_HOUR) return { ok: false, status: 429, message: "This course has taken many files in the last hour. Please wait a little and try again." };
  if (i.counts.courseBytes + i.size > COURSE_MAX_BYTES) return { ok: false, status: 507, message: "This course has reached its storage limit (1 GB of files)." };
  return { ok: true, path, kind };
}

/** The bytes are what the path says (magic bytes; SVGs safe). */
export function checkBytes(kind: MediaKind, bytes: Uint8Array): string | null {
  const problems = mediaProblems(kind, bytes);
  return problems.length ? `This file can't be added: ${problems[0]}.` : null;
}
