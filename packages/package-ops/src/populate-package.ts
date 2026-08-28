/**
 * Populate a published package from an uploaded package (the zip-upload path,
 * "Case A"). Unlike {@link importPackageFromFiles} — which creates a new
 * *trial* and can only hold text — this targets a package that is already
 * published to GitHub, so every valid file (text AND images/PDFs) is committed
 * to the paired repos and nothing is left behind.
 *
 * This module is the PURE planner: it validates the uploaded file set (the same
 * structural + two-repo checks the platform runs on import) and, if valid,
 * returns the commit plan — the public/private file changes to write, plus
 * deletions for any as-created placeholder the upload doesn't itself provide.
 * It performs no IO and never talks to GitHub; the caller (the populate route)
 * maps the planned changes onto `writeThrough` (commit first, then project).
 * The two-repo invariant is preserved end to end: every path is routed by
 * `repoForPath` and re-checked with `assertPathAllowedInEitherContract`, and
 * the bridge validates the plan once more before any network call.
 *
 * The target package's identity is authoritative: the uploaded manifest's
 * metadata (title, description, chapters, license, …) is adopted, but the
 * existing `packageId` and repo coordinates are forced — the upload populates
 * *this* package, it does not become a different one.
 *
 * ## The gate: a plan diff, not a pristine test (2026-08-28, Wave 3)
 *
 * Populate used to refuse any target that was not byte-for-byte pristine, which
 * turned every interrupted upload into a dead end ("This course already has
 * content") — the projection was written *before* the commits, so a half-failed
 * run poisoned its own retry. That gate is gone. In its place:
 *
 * - {@link diffPopulatePlan} says exactly what the upload would **add**,
 *   **replace**, leave **unchanged**, and **remove**, plus the **blockers** —
 *   authored files already in the course that this package does not cover. The
 *   caller shows that summary and takes an explicit confirmation (Tier 3).
 * - {@link pendingPopulateChanges} drops the unchanged files, which is what
 *   makes a re-run **idempotent**: re-uploading the same zip after a failure
 *   re-plans against the current state and commits only the remainder.
 * - {@link emptyCourseChanges} is the deliberate escape hatch: with the
 *   educator's second confirmation, the blockers are turned into deletions that
 *   go through the same commit path (so the course is emptied *in the repos*,
 *   not just in the cache).
 * - {@link chunkChanges} keeps each commit inside the function's time budget;
 *   whatever does not fit is completed by the next (resumed) run.
 */

import {
  assertPathAllowedInEitherContract,
  parseManifest,
  repoForPath,
  type PackageManifest,
  type RepoKind,
  type ValidationIssue,
} from "@alembic/package-contract";
import type { ImportFile } from "./import-package";
import { LICENSE_PATH, licenseFileContent } from "./license-file";
import { extractEmbeddedUid } from "./document-registry";
import { validatePackageForImport } from "./validate-package";
import { ROOT_SCAFFOLD_PATHS, SEED_CONTENT_PATHS } from "./create";

const MANIFEST_PATH = "alembic.json";
const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "");
/**
 * Advisory issues never block an upload. Two spellings are accepted: the
 * explicit `severity` field (added 2026-08-28 when "declared chapter has no
 * study guide yet" became a warning under the slot model) and the older
 * "Heads up:" message prefix that predates it.
 */
const isWarning = (i: ValidationIssue) =>
  i.severity === "warning" || i.message.startsWith("Heads up:");

/** One planned repository write. `content: null` is a deletion. */
export interface PlannedChange {
  path: string;
  content: string | null;
  encoding: "utf-8" | "base64";
}

export interface RepoRef {
  owner: string;
  name: string;
}

/**
 * A file the target package already holds. `content` is optional — supply it
 * (the store's projection does) and the diff can tell "already there, identical"
 * from "would be replaced", which is what makes a re-run skip work instead of
 * repeating it. Omit it and every existing path counts as a replacement.
 */
export interface ExistingPackageFile {
  repo: RepoKind;
  path: string;
  content?: string;
}

export interface PopulatePlanInput {
  /** The published target package — its id and repo pair are forced onto the result. */
  target: { packageId: string; publicRepo: RepoRef; privateRepo: RepoRef };
  /** The target's current files. Used for placeholder deletions and the plan diff. */
  existingFiles: ExistingPackageFile[];
  /** The uploaded, unpacked package files (text as UTF-8, binary as base64). */
  uploaded: ImportFile[];
}

export type PopulatePlanResult =
  | {
      ok: true;
      manifest: PackageManifest;
      publicChanges: PlannedChange[];
      privateChanges: PlannedChange[];
      /** Binary files (images/PDFs) committed as blobs — for the caller's summary. */
      binaryPaths: string[];
      /**
       * Advisory issues that did NOT block the plan — e.g. a declared chapter
       * with no study-guide content yet, which the slot model allows. Worth
       * showing next to the confirmation ("heads up"), never a refusal.
       */
      warnings: ValidationIssue[];
    }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Validate the uploaded package and, if valid, build the commit plan to populate
 * the published target. Returns `{ ok: false, issues }` on any error-level
 * problem (nothing to commit), else the public/private change sets.
 *
 * The plan is the **whole** intent — every uploaded file, whether or not the
 * target already has it. Ask {@link diffPopulatePlan} what that means for this
 * target, and {@link pendingPopulateChanges} for the subset still to write.
 */
export function planPackagePopulation(input: PopulatePlanInput): PopulatePlanResult {
  const files = input.uploaded.map((f) => ({ ...f, path: norm(f.path) }));
  const errors: ValidationIssue[] = [];

  // 1. Manifest present + valid JSON + valid manifest.
  const manifestFile = files.find((f) => f.path === MANIFEST_PATH);
  if (!manifestFile) {
    return {
      ok: false,
      issues: [
        { path: MANIFEST_PATH, message: "The package is missing its alembic.json settings file at the root." },
      ],
    };
  }
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(manifestFile.content);
  } catch {
    return { ok: false, issues: [{ path: MANIFEST_PATH, message: "alembic.json is not valid JSON." }] };
  }
  let parsed: PackageManifest;
  try {
    parsed = parseManifest(manifestRaw);
  } catch {
    parsed = null as unknown as PackageManifest;
  }

  // 2. Ensure a LICENSE exists — synthesize from the manifest license if absent.
  const withLicense = [...files];
  if (parsed && !files.some((f) => f.path === LICENSE_PATH)) {
    withLicense.push({ path: LICENSE_PATH, content: licenseFileContent(parsed.license), isBinary: false });
  }

  // 3. Route each file to a repo (fail-closed). Unknown folder → error.
  const tagged: { repo: RepoKind; path: string }[] = [];
  for (const f of withLicense) {
    try {
      tagged.push({ repo: repoForPath(f.path), path: f.path });
    } catch {
      errors.push({ path: f.path, message: `"${f.path}" isn't in a recognized package folder, so it can't be imported.` });
    }
  }

  // 4. Structural + two-repo validation (the same check the platform runs).
  const structural = validatePackageForImport({ manifest: manifestRaw, files: tagged });

  // 5. Duplicate embedded identity: two documents may not share a uid.
  const uidOwner = new Map<string, string>();
  for (const f of withLicense) {
    if (f.isBinary) continue;
    const uid = extractEmbeddedUid(f.content);
    if (!uid) continue;
    const prev = uidOwner.get(uid);
    if (prev) {
      errors.push({
        path: f.path,
        message: `This document shares an identity with "${prev}". Each document needs its own id — give it a fresh uid.`,
      });
    } else {
      uidOwner.set(uid, f.path);
    }
  }

  const structuralErrors = structural.issues.filter((i) => !isWarning(i));
  if (errors.length > 0 || structuralErrors.length > 0) {
    return { ok: false, issues: [...errors, ...structural.issues] };
  }

  // 6. Force the TARGET package's identity + repo pair onto the manifest.
  const manifest = parseManifest({
    ...(manifestRaw as Record<string, unknown>),
    packageId: input.target.packageId,
    publicRepo: input.target.publicRepo,
    privateRepo: input.target.privateRepo,
  });

  // 7. Build the per-repo change sets. alembic.json carries the re-stamped
  //    manifest; every other file carries its own content (base64 for binaries).
  const publicChanges: PlannedChange[] = [];
  const privateChanges: PlannedChange[] = [];
  const binaryPaths: string[] = [];
  const uploadedPaths = new Set<string>();
  for (const f of withLicense) {
    const repo = repoForPath(f.path); // safe: unknown folders already errored out
    assertPathAllowedInEitherContract(f.path, repo); // fail-closed, never trusted
    uploadedPaths.add(f.path);
    const content =
      f.path === MANIFEST_PATH ? JSON.stringify(manifest, null, 2) + "\n" : f.content;
    const change: PlannedChange = {
      path: f.path,
      content,
      encoding: f.isBinary ? "base64" : "utf-8",
    };
    if (f.isBinary) binaryPaths.push(f.path);
    (repo === "private" ? privateChanges : publicChanges).push(change);
  }

  // 8. Delete any as-created placeholder the upload didn't overwrite, so no stray
  //    "Getting started" welcome chapter or starter note survives.
  const existing = new Set(input.existingFiles.map((f) => norm(f.path)));
  for (const seed of SEED_CONTENT_PATHS) {
    if (existing.has(seed) && !uploadedPaths.has(seed)) {
      const repo = repoForPath(seed);
      (repo === "private" ? privateChanges : publicChanges).push({
        path: seed,
        content: null,
        encoding: "utf-8",
      });
    }
  }

  return {
    ok: true,
    manifest,
    publicChanges,
    privateChanges,
    binaryPaths,
    warnings: structural.issues.filter(isWarning),
  };
}

/* -------------------------------------------------------------------------- *
 * Size limit — one number, quoted in the UI and enforced at both doors
 * -------------------------------------------------------------------------- */

/**
 * Largest package archive we accept, in bytes.
 *
 * The old ~4.5 MB ceiling was not this number — it was Vercel's request-body
 * limit hit before the route ran. Now that the browser uploads straight to the
 * staging bucket, the only real limits are GitHub's per-file/repo comfort range
 * and the unzip cost, so the historical 50 MB stands: it comfortably covers a
 * whole illustrated course, and anything past it is a sign that media should be
 * linked rather than embedded (storage-and-write-paths.md §6, "today's policy:
 * link out"). Both doors — the signed-URL route and the populate route — check
 * it, and the client states it up front.
 */
export const MAX_PACKAGE_ZIP_BYTES = 50 * 1024 * 1024;

/** The limit as the educator sees it. Keep in step with the constant. */
export const MAX_PACKAGE_ZIP_LABEL = "50 MB";

/** Round bytes to a short human size ("68 MB", "900 KB"). */
export function describeBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.max(0, Math.round(bytes))} bytes`;
}

/** The educator-facing "too large" message — one wording, used everywhere. */
export function packageTooLargeMessage(bytes: number): string {
  return (
    `That .zip is ${describeBytes(bytes)}, and a course upload can be at most ` +
    `${MAX_PACKAGE_ZIP_LABEL}. Take out the largest images or videos (link to ` +
    `them instead) and upload again.`
  );
}

/* -------------------------------------------------------------------------- *
 * The gate: plan diff, idempotent replan, deliberate empty-out
 * -------------------------------------------------------------------------- */

/** One entry of the plan diff — enough for the caller to name the file. */
export interface PopulateDiffEntry {
  repo: RepoKind;
  path: string;
}

/** A planned change tagged with the repo it belongs to. */
export type RepoPlannedChange = PlannedChange & { repo: RepoKind };

/**
 * What this upload would actually do to this target, in the educator's terms.
 * Every list is sorted by path so the preview reads the same on every run.
 */
export interface PopulateDiff {
  /** Files the course does not have yet. */
  adds: PopulateDiffEntry[];
  /** Files the course already has, with DIFFERENT content — overwritten. */
  replaces: PopulateDiffEntry[];
  /** Files already present byte-for-byte. Skipped: this is the resume path. */
  unchanged: PopulateDiffEntry[];
  /** Legacy starter placeholders the upload clears out. */
  removes: PopulateDiffEntry[];
  /**
   * Authored files already in this course that the package does NOT cover.
   * They would survive the upload and be mixed in with it — so they are the
   * blockers the educator has to resolve (keep them, or empty the course).
   */
  blockers: PopulateDiffEntry[];
  /** Images/PDFs among adds+replaces, for the summary line. */
  images: number;
}

const changeKey = (repo: RepoKind, path: string) => `${repo} ${norm(path)}`;
const byPath = (a: PopulateDiffEntry, b: PopulateDiffEntry) =>
  a.path.localeCompare(b.path) || a.repo.localeCompare(b.repo);

/** Paths that are scaffold or legacy starter placeholders — never "content". */
const NON_CONTENT_PATHS: ReadonlySet<string> = new Set<string>([
  ...ROOT_SCAFFOLD_PATHS,
  ...SEED_CONTENT_PATHS,
]);

/**
 * The files that represent *authored content*: everything that is neither root
 * scaffold (`alembic.json`, `LICENSE`, …) nor one of the two legacy starter
 * placeholders older packages were seeded with. Under "slots, not placeholders"
 * (storage-and-write-paths.md §4) a file exists iff real content exists, so this
 * is a straight subtraction — no filename magic beyond the legacy tolerance,
 * which exists only because those two files are still out there.
 */
export function authoredContentFiles<T extends { path: string }>(files: T[]): T[] {
  return files.filter((f) => !NON_CONTENT_PATHS.has(norm(f.path)));
}

/**
 * TRUE when a published course is still waiting to be filled in — the condition
 * for offering the "upload your package" empty state.
 *
 * Two states qualify, and the second one matters as much as the first:
 *  1. **Nothing authored yet** — a freshly created (or freshly published)
 *     course.
 *  2. **Content, but no study guide anywhere** — the signature of an upload
 *     that stopped partway: populate commits the manifest, the license and the
 *     assets before the chapter documents, so an interrupted run leaves exactly
 *     this shape. Keeping the offer visible is what makes an interrupted upload
 *     resumable *after a page reload* instead of a dead end.
 *
 * A course an educator has actually written in has study-guide content, so it
 * is never mistaken for either state.
 */
export function packageAwaitsUpload(files: { path: string }[]): boolean {
  const content = authoredContentFiles(files);
  if (content.length === 0) return true;
  return !content.some((f) => norm(f.path).startsWith("study-guide/"));
}

/** Flatten a successful plan into one repo-tagged change list (public first). */
export function allPlannedChanges(plan: {
  publicChanges: PlannedChange[];
  privateChanges: PlannedChange[];
}): RepoPlannedChange[] {
  return [
    ...plan.publicChanges.map((c) => ({ ...c, repo: "public" as const })),
    ...plan.privateChanges.map((c) => ({ ...c, repo: "private" as const })),
  ];
}

/**
 * Compare a plan against what the target already holds. Pure; the caller turns
 * this into the confirmation summary the educator approves.
 */
export function diffPopulatePlan(
  plan: {
    publicChanges: PlannedChange[];
    privateChanges: PlannedChange[];
    binaryPaths?: string[];
  },
  existingFiles: ExistingPackageFile[],
): PopulateDiff {
  const existing = new Map<string, ExistingPackageFile>();
  for (const f of existingFiles) existing.set(changeKey(f.repo, f.path), f);

  const binaries = new Set((plan.binaryPaths ?? []).map(norm));
  const diff: PopulateDiff = {
    adds: [],
    replaces: [],
    unchanged: [],
    removes: [],
    blockers: [],
    images: 0,
  };

  const covered = new Set<string>();
  for (const change of allPlannedChanges(plan)) {
    const path = norm(change.path);
    const k = changeKey(change.repo, path);
    covered.add(k);
    const entry: PopulateDiffEntry = { repo: change.repo, path };
    const had = existing.get(k);

    if (change.content === null) {
      // A deletion only counts when there is something to delete.
      if (had) diff.removes.push(entry);
      continue;
    }
    if (!had) {
      diff.adds.push(entry);
    } else if (had.content !== undefined && had.content === change.content) {
      diff.unchanged.push(entry);
      continue;
    } else {
      diff.replaces.push(entry);
    }
    if (binaries.has(path)) diff.images += 1;
  }

  // Blockers: authored content already in the course that this package neither
  // replaces nor removes. Scaffold is excluded — it is always overwritten.
  for (const f of authoredContentFiles(existingFiles)) {
    const k = changeKey(f.repo, f.path);
    if (!covered.has(k)) diff.blockers.push({ repo: f.repo, path: norm(f.path) });
  }

  diff.adds.sort(byPath);
  diff.replaces.sort(byPath);
  diff.unchanged.sort(byPath);
  diff.removes.sort(byPath);
  diff.blockers.sort(byPath);
  return diff;
}

/**
 * The changes still worth writing: the plan minus every file already present
 * with identical content, and minus deletions of files that are already gone.
 *
 * This is the whole of the idempotence story. Re-running populate with the same
 * zip after an interrupted run re-plans from the current state and returns only
 * the remainder; running it again after a *complete* run returns nothing at all.
 */
export function pendingPopulateChanges(
  plan: { publicChanges: PlannedChange[]; privateChanges: PlannedChange[] },
  existingFiles: ExistingPackageFile[],
): RepoPlannedChange[] {
  const existing = new Map<string, ExistingPackageFile>();
  for (const f of existingFiles) existing.set(changeKey(f.repo, f.path), f);

  return allPlannedChanges(plan).filter((change) => {
    const had = existing.get(changeKey(change.repo, change.path));
    if (change.content === null) return Boolean(had); // nothing to delete
    if (!had) return true;
    return had.content === undefined || had.content !== change.content;
  });
}

/**
 * Turn the diff's blockers into deletions — the "empty this course and upload"
 * action. Deliberate and separately confirmed: it removes authored files, and
 * because the deletions travel the same commit path as everything else, they
 * leave the educator's repositories too (not just the cache). Scaffold and the
 * uploaded files themselves are never touched.
 */
export function emptyCourseChanges(diff: PopulateDiff): RepoPlannedChange[] {
  return diff.blockers.map((b) => ({
    repo: b.repo,
    path: b.path,
    content: null,
    encoding: "utf-8" as const,
  }));
}

export interface ChunkOptions {
  /** Most files in one commit. */
  maxFiles?: number;
  /** Most content bytes in one commit (base64 length counts as written). */
  maxBytes?: number;
}

/**
 * Split a change list into per-repo commit chunks, in order, so no single
 * commit is unbounded in files or bytes.
 *
 * Chunks never mix repos: a commit belongs to exactly one repository, and
 * single-repo change sets are what storage-and-write-paths.md §3 asks writers to
 * prefer. Order is preserved, so a run that stops after chunk *k* has committed
 * a prefix of the plan and the next run picks up the rest.
 */
export function chunkChanges(
  changes: RepoPlannedChange[],
  options: ChunkOptions = {},
): RepoPlannedChange[][] {
  const maxFiles = options.maxFiles ?? 40;
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
  const chunks: RepoPlannedChange[][] = [];
  let current: RepoPlannedChange[] = [];
  let bytes = 0;

  for (const change of changes) {
    const size = change.content?.length ?? 0;
    const repoChanged = current.length > 0 && current[0]!.repo !== change.repo;
    const tooMany = current.length >= maxFiles;
    // A single oversized file still gets its own chunk rather than being split.
    const tooBig = current.length > 0 && bytes + size > maxBytes;
    if (repoChanged || tooMany || tooBig) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(change);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
