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

/**
 * Read the authoritative FILE manifest with a single-row query.
 *
 * Prefer this over `manifestFromFiles(await store.listFiles(id))`: the latter
 * pulls every file's content — a real course package is hundreds of files and
 * tens of megabytes, with binaries held base64 — to answer a question about one
 * small JSON file.
 */
export async function readManifestFromStore(
  store: { readFile: (id: string, repo: "public" | "private", path: string) => Promise<string | null> },
  packageId: string,
): Promise<PackageManifest> {
  const raw = await store.readFile(packageId, "public", "alembic.json");
  if (raw === null) {
    throw new Error(
      "Package manifest file (public alembic.json) is missing — cannot update the manifest.",
    );
  }
  return parseManifest(JSON.parse(raw));
}
