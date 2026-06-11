/**
 * Storage interface for package operations.
 *
 * v0.1 has two implementations: the trial sandbox (Supabase-backed, in the
 * web app) and — from M5 — the GitHub bridge. Both must obey the same layer
 * separation; operations validate paths against the contract before any
 * store call, so a store never receives an invalid placement.
 */

import type { PackageManifest, RepoKind } from "@alembic/package-contract";

export interface PackageFile {
  /** Which repository (or sandbox partition) the file belongs to. */
  repo: RepoKind;
  /** Repository-relative path, already validated against the contract. */
  path: string;
  content: string;
}

export interface PackageRecord {
  packageId: string;
  ownerId: string;
  title: string;
  manifest: PackageManifest;
  storage: "sandbox" | "github";
}

export interface PackageStore {
  createPackage(record: PackageRecord, files: PackageFile[]): Promise<void>;
}
