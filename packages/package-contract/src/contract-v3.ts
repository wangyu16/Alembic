/**
 * Package contract v3 (FC-15 v3) — docs/specs/v3/package-contract-v3.md.
 *
 * Two repositories per course: the private WORKING repo holds the whole
 * course tree; the PUBLIC repo receives only a projection, written by
 * Publish. This module is pure (no IO) and fail-closed: every helper throws
 * `PathLayerError` (or a subclass) on anything it cannot positively accept.
 *
 * Additive during the build: v1 (`./layers`) and v2 (`./spaces`) stay until
 * the cut-over (owner ruling R31), when this module becomes the only path
 * contract.
 */

import { activeProfile } from "./profile";
import { z } from "zod";
import { PathLayerError } from "./layers";
import { SpaceBoundaryViolation, type PackageSpace } from "./spaces";

/* -------------------------------------------------------------------------- *
 * §2.1 Path hygiene
 * -------------------------------------------------------------------------- */

export const MAX_PATH_BYTES = 1024;
export const MAX_SEGMENT_BYTES = 255;

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

// Control characters (C0 + DEL) and Unicode format characters (category Cf:
// bidi overrides, zero-width joiners, BOM, …). `\p{Cf}` needs the u flag.
const FORBIDDEN_CHAR = /[\u0000-\u001f\u007f]|\p{Cf}/u;

/**
 * Validate a repository-relative path and return it unchanged. Rejects
 * (never silently rewrites) anything that could be read two ways: non-NFC
 * text, a leading slash, backslashes, empty / `.` / `..` segments, any `%`
 * (percent-encoding is never a valid file name here), control and format
 * characters, and over-long names.
 */
export function normalizePath(path: string): string {
  const fail = (why: string): never => {
    throw new PathLayerError(`Invalid path (${why}): ${JSON.stringify(path)}`, path);
  };
  if (typeof path !== "string" || path.length === 0) fail("empty");
  if (path.normalize("NFC") !== path) fail("not in Unicode NFC form");
  if (path.startsWith("/")) fail("leading slash");
  if (path.includes("\\")) fail("backslash");
  if (path.includes("%")) fail("percent sign");
  if (FORBIDDEN_CHAR.test(path)) fail("control or format character");
  if (utf8Bytes(path) > MAX_PATH_BYTES) fail("too long");
  for (const seg of path.split("/")) {
    if (seg === "") fail("empty segment");
    if (seg === "." || seg === "..") fail("dot segment");
    if (utf8Bytes(seg) > MAX_SEGMENT_BYTES) fail("segment too long");
  }
  return path;
}

/* -------------------------------------------------------------------------- *
 * §2.2 Classification (v3 space table)
 * -------------------------------------------------------------------------- */

/** Root files: the active content profile's (FD-10; Coursewerk's, D-126). */
export const ROOT_FILES_V3: readonly string[] = activeProfile.rootFiles;

export const ROOT_DIRS_V3 = [".alembic", ".github"] as const;

/** Top-level folders: the active content profile's (FD-10). */
const SPACE_DIRS_V3: Readonly<Record<string, PackageSpace>> = activeProfile.folders;

/** v3 classification: hygiene first, then the first segment decides. */
export function spaceForPathV3(path: string): PackageSpace {
  const p = normalizePath(path);
  const [first, ...rest] = p.split("/");
  if (rest.length === 0) {
    if ((ROOT_FILES_V3 as readonly string[]).includes(first!)) return "metadata";
    throw new PathLayerError(`Root file "${first}" is not in the package contract allowlist`, path);
  }
  if ((ROOT_DIRS_V3 as readonly string[]).includes(first!)) return "metadata";
  const space = SPACE_DIRS_V3[first!];
  if (!space) throw new PathLayerError(`Directory "${first}" does not map to any package space`, path);
  return space;
}

/* -------------------------------------------------------------------------- *
 * §2.3–2.5 Repository rules and projection
 * -------------------------------------------------------------------------- */

/** The working repo accepts every classifiable path (rule 3). */
export function assertPathAllowedInWorkingRepo(path: string): void {
  spaceForPathV3(path);
}

/** The public repo accepts every classifiable path except the private space (rule 4). No override, by design. */
export function assertPathAllowedInPublicRepo(path: string): void {
  const space = spaceForPathV3(path);
  if (space === "private") throw new SpaceBoundaryViolation(path, space, "public");
}

/**
 * Paths no user, editor or agent write may touch (rule 2, permissions §3):
 * dot-folders the server generates, and source pointers (a server-written
 * mirror of the `sources` table). `private/coursewerk/` is the harness's
 * and is checked separately (`isHarnessPath`).
 */
export function isServerOnlyPath(path: string): boolean {
  const p = normalizePath(path);
  return (
    p.startsWith(".github/") ||
    p.startsWith(".alembic/") ||
    p === ".gitignore" ||
    p === "private/README.md" || // the template's note: not a document (contract v3 §12.1)
    p.startsWith("private/sources/")
  );
}

/** Coursewerk records: written only by the harness through the hand-over (FC-16). */
export function isHarnessPath(path: string): boolean {
  return normalizePath(path).startsWith("private/coursewerk/");
}

/**
 * Files only Publish itself (or the publish profile) writes in the public
 * repo — never copied from the working repo (rule 5). The public
 * `alembic.json` is generated from the working one (`toPublicManifest`), so
 * the working manifest can never be copied out by mistake.
 */
export function isPublishGenerated(path: string): boolean {
  const p = normalizePath(path);
  return (
    p === "alembic.json" ||
    p.startsWith("provenance/coursewerk/") ||
    p.startsWith(".github/") ||
    p.startsWith(".alembic/") ||
    p === ".gitignore"
  );
}

/**
 * The public-repo write check Publish applies to every file of its commit:
 * a unit file must be projectable; a generated file must be on the
 * generated list. Both must pass the public-repo boundary.
 */
export function assertPublishWritable(path: string, origin: "unit" | "generated"): void {
  assertPathAllowedInPublicRepo(path);
  if (origin === "unit" && !isProjectable(path)) {
    throw new PathLayerError(`"${path}" is not projectable from the working repo`, path);
  }
  if (origin === "generated" && !isPublishGenerated(path)) {
    throw new PathLayerError(`"${path}" is not a file Publish generates`, path);
  }
}

/** May this working-repo path be copied into the public repo? (rule 5; which UNITS are published is the publisher's call.) */
export function isProjectable(path: string): boolean {
  try {
    assertPathAllowedInPublicRepo(path);
  } catch {
    return false;
  }
  return !isPublishGenerated(path);
}

/* -------------------------------------------------------------------------- *
 * §2.6 Only regular files
 * -------------------------------------------------------------------------- */

export const REGULAR_FILE_MODES = ["100644", "100755"] as const;

export class TreeEntryModeError extends PathLayerError {
  constructor(path: string, public readonly mode: string) {
    super(`Only regular files are allowed; "${path}" has mode ${mode} (symlinks and submodules are refused)`, path);
    this.name = "TreeEntryModeError";
  }
}

/** Throw unless every tree entry is a regular file (or a directory, mode 040000, which carries no content). */
export function assertRegularTree(entries: ReadonlyArray<{ path: string; mode: string; type?: string }>): void {
  for (const e of entries) {
    if (e.mode === "040000" || e.type === "tree") continue;
    if (!(REGULAR_FILE_MODES as readonly string[]).includes(e.mode)) throw new TreeEntryModeError(e.path, e.mode);
  }
}

/* -------------------------------------------------------------------------- *
 * §3 The private space
 * -------------------------------------------------------------------------- */

/** Private subfolders: the active content profile's (FD-10; interim, D-126). */
export const PRIVATE_SUBFOLDERS: readonly string[] = activeProfile.privateSubfolders;

/** Throw unless a `private/…` path sits in one of the four known subfolders (fail closed). */
export function assertPrivatePath(path: string): void {
  const p = normalizePath(path);
  const [first, second, ...rest] = p.split("/");
  if (first !== "private" || !second || rest.length === 0 || !(PRIVATE_SUBFOLDERS as readonly string[]).includes(second)) {
    throw new PathLayerError(
      `Private files live under private/{${PRIVATE_SUBFOLDERS.join(",")}}/…; got ${JSON.stringify(path)}`,
      path,
    );
  }
}

/* -------------------------------------------------------------------------- *
 * §5 Source pointer (a mirror; the `sources` row is the authority)
 * -------------------------------------------------------------------------- */

export const SOURCE_ID_PATTERN = /^src_[a-z2-7]{26}$/;

export const SourcePointerSchema = z
  .object({
    schema: z.literal("alembic.source/1"),
    id: z.string().regex(SOURCE_ID_PATTERN),
    title: z.string().min(1).max(500),
    kind: z.enum(["file", "link", "book-description"]),
    uploader: z.string().uuid(),
    aiAllowed: z.boolean(),
    sharedWithCourse: z.boolean(),
    rightsNote: z.string().max(4000),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    size: z.number().int().nonnegative().optional(),
    storageKey: z.string().min(1).max(300).optional(),
    removedAt: z.iso.datetime().nullable(),
  })
  .strict();

export type SourcePointer = z.infer<typeof SourcePointerSchema>;

/** The repo path of a source pointer. */
export function sourcePointerPath(id: string): string {
  if (!SOURCE_ID_PATTERN.test(id)) throw new PathLayerError(`Invalid source id ${JSON.stringify(id)}`, id);
  return `private/sources/${id}.json`;
}

/* -------------------------------------------------------------------------- *
 * §6 Reserved chapter slugs
 * -------------------------------------------------------------------------- */

/** Reserved unit slugs: the active content profile's (FD-10). */
export const RESERVED_CHAPTER_SLUGS: readonly string[] = activeProfile.reservedUnitSlugs;

export function isReservedChapterSlug(slug: string): boolean {
  return (RESERVED_CHAPTER_SLUGS as readonly string[]).includes(slug);
}
