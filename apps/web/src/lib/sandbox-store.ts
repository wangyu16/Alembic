import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PackageFile,
  PackageRecord,
  PackageStore,
} from "@alembic/package-ops";

/**
 * Trial-sandbox PackageStore over Supabase. Paths reaching this store have
 * already passed contract validation in package-ops; the `repo` partition
 * column keeps the public/private separation physical even before GitHub.
 */
export class SupabaseSandboxStore implements PackageStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async createPackage(
    record: PackageRecord,
    files: PackageFile[],
  ): Promise<void> {
    const { error: pkgError } = await this.supabase.from("packages").insert({
      id: record.packageId,
      owner_id: record.ownerId,
      title: record.title,
      manifest: record.manifest,
      storage: record.storage,
    });
    if (pkgError) {
      throw new Error(`Could not create the package: ${pkgError.message}`);
    }

    const { error: fileError } = await this.supabase
      .from("sandbox_files")
      .insert(
        files.map((f) => ({
          package_id: record.packageId,
          repo: f.repo,
          path: f.path,
          content: f.content,
        })),
      );
    if (fileError) {
      throw new Error(
        `Could not save the package starter files: ${fileError.message}`,
      );
    }
  }
}
