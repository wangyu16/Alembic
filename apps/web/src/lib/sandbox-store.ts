import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseManifest,
  type PackageManifest,
} from "@alembic/package-contract";
import type {
  PackageFile,
  PackageRecord,
  PackageStore,
} from "@alembic/package-ops";

/**
 * Trial-sandbox PackageStore over Supabase. Paths reaching this store have
 * already passed contract validation in package-ops; the `repo` partition
 * column keeps the public/private separation physical even before GitHub.
 *
 * Row-level security restricts every query to the owning user, so these
 * methods never need to filter by owner themselves.
 */
export class SupabaseSandboxStore implements PackageStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async createPackage(
    record: PackageRecord,
    files: PackageFile[],
  ): Promise<void> {
    const { error } = await this.supabase.from("packages").insert({
      id: record.packageId,
      owner_id: record.ownerId,
      title: record.title,
      manifest: record.manifest,
      storage: record.storage,
    });
    if (error) throw new Error(`Could not create the package: ${error.message}`);
    await this.putFiles(record.packageId, files);
  }

  async getPackage(packageId: string): Promise<PackageRecord | null> {
    const { data, error } = await this.supabase
      .from("packages")
      .select("id, owner_id, title, manifest, storage")
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
    };
  }

  async listFiles(packageId: string): Promise<PackageFile[]> {
    // PostgREST caps a single response (default max-rows, typically 1000
    // rows), so one unpaged select silently truncates large packages. Page
    // deterministically (ordered by repo, then path — together the unique
    // key within a package) until a short page signals the end.
    const PAGE = 1000;
    const files: PackageFile[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await this.supabase
        .from("sandbox_files")
        .select("repo, path, content")
        .eq("package_id", packageId)
        .order("repo")
        .order("path")
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`Could not load files: ${error.message}`);
      const rows = data ?? [];
      for (const row of rows) {
        files.push({ repo: row.repo, path: row.path, content: row.content });
      }
      if (rows.length < PAGE) break;
    }
    return files;
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
