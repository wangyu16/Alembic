/**
 * Whole-package import (offline-authoring / zip-upload path).
 *
 * Takes an UNPACKED package (the file set from a `.zip` the educator authored
 * offline, e.g. with an AI agent following the `alembic-package` skill) and
 * turns it into a new TRIAL package — after proving it is structurally valid and
 * two-repo-safe. It is a composition over existing seams (no new mechanism):
 *   validatePackageForImport → derive each file's repo (repoForPath) →
 *   createPackage through the store, exactly like createSandboxPackage.
 *
 * The single write funnel and the two-repo invariant are preserved: every file
 * lands in the repo `repoForPath` derives for its path, and each path is
 * re-checked with `assertPathAllowedInRepo` before it is stored (fail-closed).
 *
 * A trial package lives in Postgres and is text-only, so BINARY files (images,
 * PDFs, media) are not stored here — they are reported back so the caller can
 * tell the educator to add them after publishing. Text content (study guides,
 * self-contained documents, structure/plot objects, private notes) imports now.
 */

import {
  assertPathAllowedInEitherContract,
  newPackageId,
  parseManifest,
  repoForPath,
  type PackageManifest,
  type ValidationIssue,
} from "@alembic/package-contract";
import type { PackageFile, PackageStore } from "./store";
import { LICENSE_PATH, licenseFileContent } from "./license-file";
import { extractEmbeddedUid } from "./document-registry";
import { validatePackageForImport } from "./validate-package";

const MANIFEST_PATH = "alembic.json";

/** One file from an unpacked package. `isBinary` per `isBinaryPath` (app-side). */
export interface ImportFile {
  path: string;
  /** UTF-8 text, or base64 for a binary (caller decides via isBinaryPath). */
  content: string;
  isBinary: boolean;
}

export interface ImportPackageInput {
  ownerId: string;
  files: ImportFile[];
}

export type ImportPackageResult =
  | {
      ok: true;
      packageId: string;
      manifest: PackageManifest;
      /** Binary files skipped (add them after publishing). */
      skippedBinaries: string[];
    }
  | { ok: false; issues: ValidationIssue[] };

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "");
const isWarning = (i: ValidationIssue) => i.message.startsWith("Heads up:");

/**
 * Validate an unpacked package and, if valid, create a trial package from it.
 * Returns `{ ok: false, issues }` (nothing created) on any error-level problem,
 * or `{ ok: true, packageId, … }` after the package is persisted. Pure over the
 * injected store — no framework imports, deterministic (createdAt comes from the
 * author's manifest, not the clock).
 */
export async function importPackageFromFiles(
  store: PackageStore,
  input: ImportPackageInput,
): Promise<ImportPackageResult> {
  const files = input.files.map((f) => ({ ...f, path: norm(f.path) }));
  const errors: ValidationIssue[] = [];

  // 1. The manifest must be present and valid JSON, then a valid manifest.
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
    // Defer to validateProject for the detailed field-level issues.
    parsed = null as unknown as PackageManifest;
  }

  // 2. Ensure a LICENSE file exists — generate one from the manifest license so
  //    an author need not ship the legal text. (Only when the manifest parsed.)
  const withLicense = [...files];
  if (parsed && !files.some((f) => f.path === LICENSE_PATH)) {
    withLicense.push({ path: LICENSE_PATH, content: licenseFileContent(parsed.license), isBinary: false });
  }

  // 3. Derive each file's repo from its path (fail-closed). A path in no known
  //    folder is an error — it cannot be placed safely.
  const tagged: { repo: PackageFile["repo"]; path: string }[] = [];
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

  // Fail on any error: our own errors, or an error-level issue from the
  // structural validator (warnings are prefixed "Heads up:" and don't block).
  const structuralErrors = structural.issues.filter((i) => !isWarning(i));
  if (errors.length > 0 || structuralErrors.length > 0) {
    return { ok: false, issues: [...errors, ...structural.issues] };
  }

  // 6. Create the trial package. Mint a fresh platform packageId (the platform
  //    owns ids); re-stamp the manifest and its alembic.json content.
  const packageId = newPackageId(parsed.title);
  const manifest = parseManifest({
    ...(manifestRaw as Record<string, unknown>),
    packageId,
  });

  const skippedBinaries = withLicense.filter((f) => f.isBinary).map((f) => f.path);
  const outFiles: PackageFile[] = [];
  for (const f of withLicense) {
    if (f.isBinary) continue; // trial is text-only; reported above
    const content =
      f.path === MANIFEST_PATH ? JSON.stringify(manifest, null, 2) + "\n" : f.content;
    outFiles.push({ repo: repoForPath(f.path), path: f.path, content });
  }

  // Fail-closed one more time before persisting — the invariant is never trusted.
  // Dual-mode (v1 layers OR v2 spaces), so a native-v2 path like `private/…`
  // is validated the same way `repoForPath` derived it.
  for (const f of outFiles) assertPathAllowedInEitherContract(f.path, f.repo);

  await store.createPackage(
    { packageId, ownerId: input.ownerId, title: manifest.title, manifest, storage: "sandbox" },
    outFiles,
  );

  return { ok: true, packageId, manifest, skippedBinaries };
}
