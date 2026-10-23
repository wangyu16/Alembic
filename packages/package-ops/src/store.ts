/**
 * Storage interface for package operations.
 *
 * v0.1 has two implementations: the trial sandbox (Supabase-backed, in the
 * web app) and — from M5 — the GitHub bridge. Both must obey the same layer
 * separation; operations validate paths against the contract before any
 * store call, so a store never receives an invalid placement.
 */

import type { PackageManifest, RepoKind, RepoRef } from "@alembic/package-contract";
import type { DocumentRegistryStore } from "./document-registry";

/** One entry of a content-free listing. `contentSha256` = SHA-256 (hex) of
 *  the stored bytes when the backend can compute it without shipping them
 *  (Postgres: a generated column) — the page-load staleness check uses it. */
export interface PackagePathEntry {
  repo: RepoKind;
  path: string;
  contentSha256?: string | null;
}

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
  /**
   * The repositories the PUBLISH PATH recorded (`packages.public_repo` /
   * `private_repo`, written by the service role only since migration 0025).
   * Every server read or write of a published package's repositories uses
   * these, never `manifest.publicRepo` / `privateRepo`, which the owner can
   * rewrite at will (security loop r2, P5.S.3.e). Absent when the store does
   * not track them (the in-memory test store): then there is no recorded repo.
   */
  repos?: { public: RepoRef | null; private: RepoRef | null };
}

export interface PackageStore {
  /**
   * The document registry this store's writes are registered in (loop r1b,
   * P5.B.1.m). When present, `writeThrough` and `updateManifest` register
   * every file they wrote — in the ONE write path, so no caller can forget
   * (before r1b, most content saves never registered and the registry's
   * `source_hash` went stale). The production store always carries one;
   * the in-memory store carries one only when a test hands it one.
   */
  readonly registry?: DocumentRegistryStore;
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
  listPaths(packageId: string): Promise<PackagePathEntry[]>;
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
