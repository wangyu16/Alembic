import type { PackageFile } from "@alembic/package-ops";
import { parseManifest, type PackageManifest } from "@alembic/package-contract";

/**
 * The authoritative manifest, read from the FILE copy (the `alembic.json` row
 * in the public repo/sandbox partition). The `packages.manifest` DB column is
 * only a derived read cache and can be stale (e.g. it misses chapters added
 * since it was last refreshed) — so every manifest WRITE must start from this
 * file copy, never from `record.manifest`, or those chapters are silently
 * erased when the patched manifest is written back.
 *
 * Pure: takes the result of `store.listFiles(packageId)`; no IO.
 */
export function manifestFromFiles(files: PackageFile[]): PackageManifest {
  const file = files.find((f) => f.repo === "public" && f.path === "alembic.json");
  if (!file) {
    throw new Error(
      "Package manifest file (public alembic.json) is missing — cannot update the manifest.",
    );
  }
  return parseManifest(JSON.parse(file.content));
}
