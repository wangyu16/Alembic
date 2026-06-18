/**
 * Package-level lifecycle: title rename.
 *
 * Delete / archive / restore / purge are projection-row operations that live in
 * the web app (they mutate the `packages` row and, for archive, the portal
 * listing — never package content). The one content-bearing lifecycle action is
 * renaming the title, because the title lives in the manifest (`alembic.json`),
 * the package's conceptual source of truth. This op updates that file through
 * the validated store path; for GitHub-backed packages the caller mirrors the
 * updated manifest to the public repo, exactly as chapter operations do.
 *
 * `packageId` and repo names are never touched — only the display title.
 */

import {
  assertPathAllowedInRepo,
  parseManifest,
  type PackageManifest,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";

const MANIFEST_PATH = "alembic.json";

export class PackageRenameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageRenameError";
  }
}

/** Trim and validate a proposed title. Pure; no IO. */
export function normalizeTitle(raw: string): string {
  const title = raw.trim();
  if (!title) {
    throw new PackageRenameError("Give the package a title.");
  }
  if (title.length > 200) {
    throw new PackageRenameError("That title is too long (max 200 characters).");
  }
  return title;
}

/** Return a copy of the manifest with a new title. Pure; no IO. */
export function withTitle(
  manifest: PackageManifest,
  title: string,
): PackageManifest {
  return { ...manifest, title };
}

/**
 * Rename a package's display title: update the title in `alembic.json` (the
 * manifest, source of truth) through the store, and return the updated manifest
 * so the caller can refresh the projection row and mirror the change to GitHub.
 * Does not change `packageId` or repo names.
 */
export async function renamePackageTitle(
  store: PackageStore,
  packageId: string,
  rawTitle: string,
): Promise<PackageManifest> {
  const title = normalizeTitle(rawTitle);

  const files = await store.listFiles(packageId);
  const manifestFile = files.find(
    (f) => f.repo === "public" && f.path === MANIFEST_PATH,
  );
  if (!manifestFile) {
    throw new PackageRenameError(
      `Manifest (${MANIFEST_PATH}) not found for package ${packageId}`,
    );
  }

  const manifest = parseManifest(JSON.parse(manifestFile.content));
  const updated = withTitle(manifest, title);

  assertPathAllowedInRepo(MANIFEST_PATH, "public");
  await store.putFiles(packageId, [
    {
      repo: "public",
      path: MANIFEST_PATH,
      content: JSON.stringify(updated, null, 2) + "\n",
    },
  ]);

  return updated;
}
