"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { releaseGates } from "@alembic/package-ops";
import { isOpenLicense } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";

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
  const repo = record?.storage === "github" ? record.manifest.publicRepo : null;
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

  const { error } = await supabase.from("portal_registrations").upsert({
    package_id: packageId,
    owner_id: user.id,
    title: record!.title,
    description: record!.manifest.description ?? "",
    keywords: record!.manifest.keywords ?? [],
    discipline: record!.manifest.discipline ?? "chemistry",
    license: record!.manifest.license,
    public_repo_url: `https://github.com/${repo.owner}/${repo.name}`,
    site_url: `https://${repo.owner}.github.io/${repo.name}/`,
    accessibility_status: record!.manifest.accessibility?.status ?? "unknown",
  });
  if (error) {
    return { ok: false, error: "Could not list the package. Please try again." };
  }

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

  const { error } = await supabase
    .from("portal_registrations")
    .delete()
    .eq("package_id", packageId);
  if (error) {
    return { ok: false, error: "Could not remove the listing. Please try again." };
  }
  revalidatePath(`/workspace/${packageId}`);
  revalidatePath("/portal");
  return { ok: true };
}
