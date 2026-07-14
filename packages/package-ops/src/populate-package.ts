/**
 * Populate a published EMPTY package from an uploaded package (the zip-upload
 * path, "Case A"). Unlike {@link importPackageFromFiles} — which creates a new
 * *trial* and can only hold text — this targets a package that is already
 * published to GitHub, so every valid file (text AND images/PDFs) is committed
 * to the paired repos and nothing is left behind.
 *
 * This module is the PURE planner: it validates the uploaded file set (the same
 * structural + two-repo checks the platform runs on import) and, if valid,
 * returns the commit plan — the public/private file changes to write, plus
 * deletions for any as-created placeholder the upload doesn't itself provide.
 * It performs no IO and never talks to GitHub; the caller (a web action) maps
 * the planned changes onto the GitHub bridge and the store projection. The
 * two-repo invariant is preserved end to end: every path is routed by
 * `repoForPath` and re-checked with `assertPathAllowedInEitherContract`, and
 * the bridge validates the plan once more before any network call.
 *
 * The target package's identity is authoritative: the uploaded manifest's
 * metadata (title, description, chapters, license, …) is adopted, but the
 * existing `packageId` and repo coordinates are forced — the upload populates
 * *this* package, it does not become a different one.
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
import { SEED_CONTENT_PATHS } from "./create";

const MANIFEST_PATH = "alembic.json";
const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "");
const isWarning = (i: ValidationIssue) => i.message.startsWith("Heads up:");

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

export interface PopulatePlanInput {
  /** The published target package — its id and repo pair are forced onto the result. */
  target: { packageId: string; publicRepo: RepoRef; privateRepo: RepoRef };
  /** The current (pristine) files of the target, to compute placeholder deletions. */
  existingFiles: { repo: RepoKind; path: string }[];
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
    }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Validate the uploaded package and, if valid, build the commit plan to populate
 * the (pristine, published) target. Returns `{ ok: false, issues }` on any
 * error-level problem (nothing to commit), else the public/private change sets.
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

  return { ok: true, manifest, publicChanges, privateChanges, binaryPaths };
}
