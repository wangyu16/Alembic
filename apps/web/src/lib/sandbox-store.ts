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
    const { data, error } = await this.supabase
      .from("sandbox_files")
      .select("repo, path, content")
      .eq("package_id", packageId);
    if (error) throw new Error(`Could not load files: ${error.message}`);
    return (data ?? []).map((row) => ({
      repo: row.repo,
      path: row.path,
      content: row.content,
    }));
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
}
