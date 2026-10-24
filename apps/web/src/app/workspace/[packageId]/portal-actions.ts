"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { releaseGates } from "@alembic/package-ops";
import { isOpenLicense } from "@alembic/package-contract";
import { discoveryChanged } from "@/lib/discovery-cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { recordDiscoveryEvent } from "@/lib/record-discovery-event";
import { recordedPublicRepo, repoUrl } from "@/lib/recorded-repo";
import { packageTrustWriter } from "@/lib/package-trust-writes";
import { createServiceClient } from "@/lib/supabase/service";
import { flushDiscovery } from "@/lib/discovery-flush";

export interface RegisterResult {
  ok: boolean;
  gateFailures?: Array<{ name: string; message: string }>;
  error?: string;
}

/**
 * Register a published package on the public discovery index. Explicit,
 * gated educator action (Tier 3) — the index is a public-safe projection.
 *
 * Two listing preconditions beyond publication:
 *   - an OPEN license (an all-rights-reserved package grants no reuse, so there
 *     is nothing to list — it stays usable privately / for a class);
 *   - the educator's copyright ATTESTATION (they confirm they hold or have
 *     cleared the rights and the content is original or open-licensed). The
 *     platform cannot prove cleanliness, so the educator certifies it; the
 *     attestation is recorded in the event log.
 */
export async function registerPackageAction(
  packageId: string,
  attestation?: boolean,
): Promise<RegisterResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  // Listing on the public index is open to every signed-in educator.
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  const repo = recordedPublicRepo(record);
  if (!repo) {
    return { ok: false, error: "Publish to GitHub before listing on the index." };
  }

  if (!isOpenLicense(record!.manifest.license)) {
    return {
      ok: false,
      error:
        "Only openly-licensed packages can be listed on Discover. Set an open license " +
        "(CC BY, BY-SA, BY-NC, BY-NC-SA, or CC0) first — an all-rights-reserved package stays " +
        "private and usable for your own class.",
    };
  }
  if (!attestation) {
    return {
      ok: false,
      error:
        "Please confirm you hold or have cleared the rights to share this content, and that every " +
        "part is original or openly licensed, before listing it publicly.",
    };
  }

  const gates = await releaseGates(store, packageId);
  if (!gates.ok) {
    return {
      ok: false,
      gateFailures: gates.checks
        .filter((c) => !c.ok)
        .map((c) => ({ name: c.name, message: c.message })),
    };
  }

  // The listing row is written by the SERVER after the gates above (security
  // loop r2, NEW-5; migration 0028_loop_r2_4): the API roles may no longer
  // insert or update portal_registrations, so nobody can list a course
  // without its attestation and release gates. Scoped to this owner.
  const listed = await packageTrustWriter(createServiceClient).recordListing(packageId, user.id, {
    title: record!.title,
    description: record!.manifest.description ?? "",
    keywords: record!.manifest.keywords ?? [],
    discipline: record!.manifest.discipline ?? "chemistry",
    license: record!.manifest.license,
    public_repo_url: repoUrl(repo),
    site_url: `https://${repo.owner}.github.io/${repo.name}/`,
    // (no accessibility_status: the database copies the server's own check,
    // packages.a11y_status — never the owner-written manifest field; P5.S.3.h)
  });
  if (!listed.ok) {
    return { ok: false, error: "Could not list the package. Please try again." };
  }
  await flushDiscovery(supabase, packageId);

  const attestedAt = new Date().toISOString();
  await supabaseEventLogger(supabase).log({
    type: "portal.registered",
    userId: user.id,
    packageId,
    detail: { license: record!.manifest.license, attested: true, attestedAt },
    occurredAt: attestedAt,
  });
  revalidatePath(`/workspace/${packageId}`);
  revalidatePath("/portal");
  discoveryChanged();
  return { ok: true };
}

export async function unregisterPackageAction(
  packageId: string,
): Promise<RegisterResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: removed, error } = await supabase
    .from("portal_registrations")
    .delete()
    .eq("package_id", packageId)
    .select("package_id");
  if (error) {
    return { ok: false, error: "Could not remove the listing. Please try again." };
  }
  if (removed?.length) {
    recordDiscoveryEvent(
      { type: "portal.unregistered", packageId, reason: "owner" },
      { userId: user.id, session: supabase },
    );
  }
  revalidatePath(`/workspace/${packageId}`);
  revalidatePath("/portal");
  discoveryChanged();
  return { ok: true };
}
