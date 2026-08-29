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
  getPackage(packageId: string): Promise<PackageRecord | null>;
  listFiles(packageId: string): Promise<PackageFile[]>;
  /**
   * Every file's (repo, path) WITHOUT its content.
   *
   * `listFiles` returns whole file bodies, which is ruinous for the questions
   * that only need to know what exists: a real course package runs to hundreds
   * of files and tens of megabytes (binaries are stored base64, inflating them
   * by a third), and pulling all of it to answer "is this course empty?" or "is
   * this path taken?" is what made a large package unopenable. Implementations
   * MUST project only the two columns.
   */
  listPaths(packageId: string): Promise<Array<{ repo: RepoKind; path: string }>>;
  /**
   * One file's content, or null when absent. For the very common case of
   * reading a single known path (`alembic.json`, one chapter's document)
   * without dragging the whole package through memory.
   */
  readFile(
    packageId: string,
    repo: RepoKind,
    path: string,
  ): Promise<string | null>;
  /** Upsert files by (repo, path). Callers validate paths first. */
  putFiles(packageId: string, files: PackageFile[]): Promise<void>;
  /**
   * Delete files by (repo, path). Missing files are ignored (idempotent).
   * Callers validate paths first.
   */
  deleteFiles(
    packageId: string,
    files: { repo: RepoKind; path: string }[],
  ): Promise<void>;
  /**
   * Compare-and-swap write of ONE file — the optimistic-concurrency primitive
   * behind `updateManifest` (storage-and-write-paths.md §3, "one manifest
   * owner"). Two writers racing on the same file can no longer silently lose
   * one another's change: the loser gets `"conflict"` and re-reads.
   *
   * - `expected === null` → **create-only**: the write applies only if no row
   *   exists yet for `(packageId, repo, path)`; an existing row → `"conflict"`.
   * - otherwise → the write applies only if the stored content is still
   *   byte-identical to `expected.content`; anything else → `"conflict"`.
   *
   * Deliberately compares on **content equality** (no hash/version column, no
   * migration): the manifest is small and the comparison is exact.
   * Callers validate paths first, exactly as for `putFiles`.
   */
  replaceFileIf(
    packageId: string,
    file: PackageFile,
    expected: { content: string } | null,
  ): Promise<"ok" | "conflict">;
}
