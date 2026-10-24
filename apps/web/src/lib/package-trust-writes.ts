import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackageManifest } from "@alembic/package-contract";

/**
 * The ONLY writers of the package columns discovery and `/d` trust
 * (security loop r1, M2; migration 0025_loop_r1_2_package_trust.sql):
 *
 *   storage, public_repo, private_repo   — the publish action, after the
 *                                          GitHub App created the repos under
 *                                          the educator's own installation;
 *   archived_at                          — archive / restore;
 *   a11y_status, a11y_checked_at,
 *   a11y_checked_sha                     — the server-side accessibility check
 *                                          and the public head it audited.
 *
 * Since 0025 the API roles cannot write these columns at all (column grants),
 * so an owner can no longer publish a trial course, un-archive it, re-point
 * its repository or claim an accessibility result by calling the database
 * directly. These writes go through the service client — which bypasses RLS,
 * so every update is ALSO filtered on `owner_id`: the caller passes the user
 * id from `auth.getUser()`, and a package that is not theirs matches no row.
 *
 * Without SUPABASE_SECRET_KEY the publish/archive/restore writes fail loudly
 * (`ok: false`); the accessibility record is best-effort (the check itself is
 * still saved in the course's manifest).
 */

export type TrustWriteResult = { ok: true } | { ok: false; reason: "no-service-client" | "not-found" | "failed" };

export interface RepoRef {
  owner: string;
  name: string;
}

type ServiceFactory = () => SupabaseClient | null;

/** The listing snapshot registerPackageAction writes (portal_registrations columns). */
export interface ListingSnapshot {
  title: string;
  description: string;
  keywords: string[];
  discipline: string;
  license: string;
  public_repo_url: string;
  site_url: string;
  // (accessibility_status is NOT part of the snapshot: the database sets it
  // from packages.a11y_status — 0030_loop_r3c_4, security r3 LOW-3, P5.S.3.h.)
}

async function ownerScopedUpdate(
  service: SupabaseClient | null,
  packageId: string,
  ownerId: string,
  patch: Record<string, unknown>,
): Promise<TrustWriteResult> {
  if (!service) return { ok: false, reason: "no-service-client" };
  try {
    const { data, error } = await service
      .from("packages")
      .update(patch)
      .eq("id", packageId)
      .eq("owner_id", ownerId)
      .select("id");
    if (error) return { ok: false, reason: "failed" };
    if (!data || data.length === 0) return { ok: false, reason: "not-found" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export function packageTrustWriter(serviceFactory: ServiceFactory) {
  return {
    /** Publish: the repos the App just created + the manifest naming them. */
    recordPublished(
      packageId: string,
      ownerId: string,
      v: { publicRepo: RepoRef; privateRepo: RepoRef; manifest: PackageManifest },
    ): Promise<TrustWriteResult> {
      return ownerScopedUpdate(serviceFactory(), packageId, ownerId, {
        storage: "github",
        public_repo: { owner: v.publicRepo.owner, name: v.publicRepo.name },
        private_repo: { owner: v.privateRepo.owner, name: v.privateRepo.name },
        manifest: v.manifest,
      });
    },

    /** Archive (a timestamp) or restore (null). */
    setArchived(packageId: string, ownerId: string, archivedAt: string | null): Promise<TrustWriteResult> {
      return ownerScopedUpdate(serviceFactory(), packageId, ownerId, { archived_at: archivedAt });
    },

    /**
     * "List publicly" (security loop r2, NEW-5; migration 0028_loop_r2_4): the
     * API roles may no longer insert or update `portal_registrations`, so the
     * listing is written HERE, after registerPackageAction has checked every
     * gate (published, open licence, attestation, release gates). The service
     * client bypasses RLS, so the package must first be proven to be this
     * owner's; the row names that owner explicitly. Unlisting stays the
     * owner's own DELETE.
     */
    async recordListing(packageId: string, ownerId: string, snapshot: ListingSnapshot): Promise<TrustWriteResult> {
      const service = serviceFactory();
      if (!service) return { ok: false, reason: "no-service-client" };
      try {
        const { data: own, error: readError } = await service
          .from("packages")
          .select("id")
          .eq("id", packageId)
          .eq("owner_id", ownerId)
          .maybeSingle();
        if (readError) return { ok: false, reason: "failed" };
        if (!own) return { ok: false, reason: "not-found" };
        const { error } = await service
          .from("portal_registrations")
          .upsert({ package_id: packageId, owner_id: ownerId, ...snapshot }, { onConflict: "package_id" });
        return error ? { ok: false, reason: "failed" } : { ok: true };
      } catch {
        return { ok: false, reason: "failed" };
      }
    },

    /** The server-side accessibility check's result (what Discover trusts). */
    recordA11yCheck(
      packageId: string,
      ownerId: string,
      v: { status: "pass" | "warn" | "fail" | "unknown"; checkedAt: string; checkedSha?: string | null },
    ): Promise<TrustWriteResult> {
      // The head it audited goes with it: when the recorded public head moves
      // on, the database resets the status to "not checked" (P5.S.3.i).
      return ownerScopedUpdate(serviceFactory(), packageId, ownerId, {
        a11y_status: v.status,
        a11y_checked_at: v.checkedAt,
        ...(v.checkedSha !== undefined ? { a11y_checked_sha: v.checkedSha } : {}),
      });
    },
  };
}
