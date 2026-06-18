"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { releaseGates } from "@alembic/package-ops";
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
 */
export async function registerPackageAction(
  packageId: string,
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
    discipline: record!.manifest.discipline ?? "chemistry",
    license: record!.manifest.license,
    public_repo_url: `https://github.com/${repo.owner}/${repo.name}`,
    site_url: `https://${repo.owner}.github.io/${repo.name}/`,
    accessibility_status: record!.manifest.accessibility?.status ?? "unknown",
  });
  if (error) {
    return { ok: false, error: "Could not list the package. Please try again." };
  }

  await supabaseEventLogger(supabase).log({
    type: "portal.registered",
    userId: user.id,
    packageId,
    detail: { license: record!.manifest.license },
    occurredAt: new Date().toISOString(),
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
