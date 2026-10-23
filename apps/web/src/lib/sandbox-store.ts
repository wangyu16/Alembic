import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseManifest,
  type PackageManifest,
} from "@alembic/package-contract";
import type {
  DocumentRegistryStore,
  PackageFile,
  PackagePathEntry,
  PackageRecord,
  PackageStore,
} from "@alembic/package-ops";
import { SupabaseDocumentRegistryStore } from "./document-registry-store";
import { pageAllKeyset, type PageResult } from "./page-all";
import { asRepoRef } from "./recorded-repo";

/**
 * Trial-sandbox PackageStore over Supabase. Paths reaching this store have
 * already passed contract validation in package-ops; the `repo` partition
 * column keeps the public/private separation physical even before GitHub.
 *
 * Row-level security restricts every query to the owning user, so these
 * methods never need to filter by owner themselves.
 */
export class SupabaseSandboxStore implements PackageStore {
  /**
   * Every write through this store (`writeThrough` / `updateManifest`) is
   * registered in the `documents` registry over the same client (loop r1b,
   * P5.B.1.m) — the write path does it, so no server action can forget.
   */
  readonly registry: DocumentRegistryStore;

  constructor(private readonly supabase: SupabaseClient) {
    this.registry = new SupabaseDocumentRegistryStore(supabase);
  }

  async createPackage(
    record: PackageRecord,
    files: PackageFile[],
  ): Promise<void> {
    // A package row is born a trial: `storage` (default 'sandbox') and
    // `archived_at` are service-role-only columns since migration 0025
    // (security loop r1 M2), so they are never sent; publishing records
    // storage through lib/package-trust-writes.ts.
    if (record.storage !== "sandbox") {
      throw new Error("Could not create the package: a new course always starts as a trial.");
    }
    const { error } = await this.supabase.from("packages").insert({
      id: record.packageId,
      owner_id: record.ownerId,
      title: record.title,
      manifest: record.manifest,
    });
    if (error) throw new Error(`Could not create the package: ${error.message}`);
    await this.putFiles(record.packageId, files);
  }

  async getPackage(packageId: string): Promise<PackageRecord | null> {
    const { data, error } = await this.supabase
      .from("packages")
      .select("id, owner_id, title, manifest, storage, public_repo, private_repo")
      .eq("id", packageId)
      .maybeSingle();
    if (error) throw new Error(`Could not load the package: ${error.message}`);
    if (!data) return null;
    return {
      packageId: data.id,
      ownerId: data.owner_id,
      title: data.title,
      manifest: parseManifest(data.manifest) as PackageManifest,
      storage: data.storage,
      // The publish-recorded repos (service-role columns, 0025) — what every
      // server read/write of a published package uses (loop r2, P5.S.3.e).
      repos: { public: asRepoRef(data.public_repo), private: asRepoRef(data.private_repo) },
    };
  }

  async listFiles(packageId: string): Promise<PackageFile[]> {
    const rows = await this.walk<{ repo: "public" | "private"; path: string; content: string }>(
      packageId,
      "repo, path, content",
    );
    return rows.map((row) => ({ repo: row.repo, path: row.path, content: row.content }));
  }

  /**
   * Paths only — never content. A real package is hundreds of files and tens of
   * megabytes (binaries live here base64-encoded), so selecting `content` to
   * answer "what exists?" pulls the whole course through a serverless function
   * on every page load. Same pagination as `listFiles`, since the row cap
   * applies regardless of how few columns are projected.
   */
  async listPaths(packageId: string): Promise<PackagePathEntry[]> {
    // `content_sha256` is a generated column (migration 0027): the database
    // hashes the stored bytes, so the page-load staleness check stays
    // content-free (P5.B.1.m).
    const rows = await this.walk<{ repo: "public" | "private"; path: string; content_sha256: string | null }>(
      packageId,
      "repo, path, content_sha256",
    );
    return rows.map((r) => ({ repo: r.repo, path: r.path, contentSha256: r.content_sha256 ?? null }));
  }

  /**
   * Every file row of a package, in (repo, path) order. PostgREST caps a
   * single response (max-rows), so one unpaged select silently truncates a
   * large package. Paged by KEYSET (loop r2, L-4): each repo is walked
   * separately by `path` (unique within a repo; (package, repo, path) is the
   * primary key) — "private" then "public", the order `order by repo, path`
   * gave — and a page ends only on the remaining count or an empty page
   * (`pageAllKeyset`: a short page is not the end, and a row deleted between
   * pages cannot hide a surviving one — P5.B.1.p).
   */
  private async walk<T extends { path: string }>(packageId: string, columns: string): Promise<T[]> {
    const out: T[] = [];
    for (const repo of ["private", "public"] as const) {
      out.push(
        ...(await pageAllKeyset<T, string>(
          (after, limit) => {
            let query = this.supabase
              .from("sandbox_files")
              .select(columns, { count: "exact" })
              .eq("package_id", packageId)
              .eq("repo", repo);
            if (after !== null) query = query.gt("path", after);
            return query.order("path").limit(limit) as unknown as PromiseLike<PageResult<T>>;
          },
          (row) => row.path,
          "Could not load files",
        )),
      );
    }
    return out;
  }

  /** One file's content, or null when absent — no whole-package read. */
  async readFile(
    packageId: string,
    repo: "public" | "private",
    path: string,
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("sandbox_files")
      .select("content")
      .eq("package_id", packageId)
      .eq("repo", repo)
      .eq("path", path)
      .maybeSingle();
    if (error) throw new Error(`Could not load file: ${error.message}`);
    return data?.content ?? null;
  }

  async putFiles(packageId: string, files: PackageFile[]): Promise<void> {
    if (files.length === 0) return;
    const { error } = await this.supabase.from("sandbox_files").upsert(
      files.map((f) => ({
        package_id: packageId,
        repo: f.repo,
        path: f.path,
        content: f.content,
      })),
      { onConflict: "package_id,repo,path" },
    );
    if (error) throw new Error(`Could not save files: ${error.message}`);
  }

  async deleteFiles(
    packageId: string,
    files: { repo: "public" | "private"; path: string }[],
  ): Promise<void> {
    for (const f of files) {
      const { error } = await this.supabase
        .from("sandbox_files")
        .delete()
        .eq("package_id", packageId)
        .eq("repo", f.repo)
        .eq("path", f.path);
      if (error) throw new Error(`Could not delete file: ${error.message}`);
    }
  }

  /**
   * Compare-and-swap write of one file (see `PackageStore.replaceFileIf`).
   * Postgres does the comparison, so two concurrent tabs cannot both win:
   *
   * - `expected === null` → a plain INSERT; the `(package_id, repo, path)`
   *   unique constraint turns "someone created it first" into `"conflict"`.
   * - otherwise → an UPDATE additionally keyed on the old `content`. `.select()`
   *   makes PostgREST return the affected rows, so zero rows back means the
   *   stored content had already moved → `"conflict"`.
   *
   * Deliberately no hash/version column and no migration: content equality is
   * exact, and the manifest (the only CAS caller today) is small.
   */
  async replaceFileIf(
    packageId: string,
    file: PackageFile,
    expected: { content: string } | null,
  ): Promise<"ok" | "conflict"> {
    if (expected === null) {
      const { error } = await this.supabase.from("sandbox_files").insert({
        package_id: packageId,
        repo: file.repo,
        path: file.path,
        content: file.content,
      });
      if (!error) return "ok";
      // 23505 = unique_violation: the row already exists, so create-only loses.
      if ((error as { code?: string }).code === "23505") return "conflict";
      throw new Error(`Could not save files: ${error.message}`);
    }

    const { data, error } = await this.supabase
      .from("sandbox_files")
      .update({ content: file.content })
      .eq("package_id", packageId)
      .eq("repo", file.repo)
      .eq("path", file.path)
      .eq("content", expected.content)
      .select("path");
    if (error) throw new Error(`Could not save files: ${error.message}`);
    return (data?.length ?? 0) > 0 ? "ok" : "conflict";
  }
}
