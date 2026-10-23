import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepoRef } from "@alembic/package-contract";
import type { PackageRecord } from "@alembic/package-ops";

/**
 * The repositories of a PUBLISHED package, as the publish path recorded them
 * (security loop r2, NEW-1, claim P5.S.3.e).
 *
 * `packages.public_repo` / `private_repo` are written only by the service role
 * (the publish action, after the GitHub App created the repos under the
 * educator's own installation — migration 0025, lib/package-trust-writes.ts).
 * `manifest.publicRepo` / `privateRepo` are owner-writable: the API lets an
 * owner PATCH `packages.manifest`, and the manifest file is theirs to edit.
 * Before r2, `/d`, includes and element adaptation fetched bytes from the
 * MANIFEST's repo, so a course could serve (and re-license) another
 * educator's repository under its own docIds; commits, snapshots, reconcile
 * and the website went there too. Every server read or write of a published
 * package's repository now goes through these helpers;
 * `recorded-repo.scan.test.ts` refuses any other `manifest.publicRepo` read.
 *
 * Pure (no `server-only`) so it is unit-testable.
 */

/** A `{ owner, name }` JSON value, or null for anything else. */
export function asRepoRef(v: unknown): RepoRef | null {
  if (!v || typeof v !== "object") return null;
  const { owner, name } = v as { owner?: unknown; name?: unknown };
  if (typeof owner !== "string" || typeof name !== "string") return null;
  if (!owner.trim() || !name.trim()) return null;
  return { owner, name };
}

/** The recorded public repo of a published package, else null. */
export function recordedPublicRepo(record: PackageRecord | null | undefined): RepoRef | null {
  if (!record || record.storage !== "github") return null;
  return record.repos?.public ?? null;
}

/** The recorded private repo of a published package, else null. */
export function recordedPrivateRepo(record: PackageRecord | null | undefined): RepoRef | null {
  if (!record || record.storage !== "github") return null;
  return record.repos?.private ?? null;
}

/** `https://github.com/{owner}/{name}` for a recorded repo. */
export function repoUrl(repo: RepoRef): string {
  return `https://github.com/${repo.owner}/${repo.name}`;
}

/**
 * For callers holding only a db client and a package id (the `/d` byte
 * source): the package's storage and its recorded public repo.
 */
export async function loadRecordedPublicRepo(
  db: SupabaseClient,
  packageId: string,
): Promise<{ found: boolean; published: boolean; repo: RepoRef | null }> {
  const { data } = await db
    .from("packages")
    .select("storage, public_repo")
    .eq("id", packageId)
    .maybeSingle();
  if (!data) return { found: false, published: false, repo: null };
  const row = data as { storage?: string; public_repo?: unknown };
  const published = row.storage === "github";
  return { found: true, published, repo: published ? asRepoRef(row.public_repo) : null };
}
