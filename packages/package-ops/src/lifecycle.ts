/**
 * Package-level lifecycle: title rename — the pure halves.
 *
 * Delete / archive / restore / purge are projection-row operations that live in
 * the web app (they mutate the `packages` row and, for archive, the portal
 * listing — never package content). The one content-bearing lifecycle action is
 * renaming the title, because the title lives in the manifest (`alembic.json`).
 * The caller applies `withTitle` through `updateManifest` — the ONE manifest
 * writer (compare-and-swap, commit first when published).
 *
 * Loop r3 (P5.B.1.y): the old `renamePackageTitle` wrote `alembic.json` with a
 * raw `putFiles` (no compare-and-swap, no commit, no registration). It had no
 * callers and was a ready-made bypass, so it is gone.
 *
 * `packageId` and repo names are never touched — only the display title.
 */

import type { PackageManifest } from "@alembic/package-contract";

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
