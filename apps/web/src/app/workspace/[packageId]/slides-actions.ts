"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generateSlidesArtifact } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { syncFilesToGitHub } from "@/lib/github";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface SlidesResult {
  ok: boolean;
  /** Repo-relative path of the generated deck. */
  path?: string;
  error?: string;
}

/**
 * Generate (or regenerate) a chapter's slide deck from its study-guide blocks
 * (M13). Deterministic — re-running overwrites the same `.slides.html` and
 * clears staleness. Syncs the deck to the public repo for GitHub-backed packages.
 */
export async function generateSlidesAction(
  packageId: string,
  path?: string,
): Promise<SlidesResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const record = await store.getPackage(packageId);
    const { record: art, carrier } = await generateSlidesArtifact(store, packageId, {
      path,
      packageTitle: record?.title,
    });
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path: art.path, content: carrier }],
      "Generate slides (Alembic)",
    );
    await supabaseEventLogger(supabase).log({
      type: "artifact.generated",
      userId: user.id,
      packageId,
      detail: { kind: "slides", path: art.path },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, path: art.path };
  } catch {
    return { ok: false, error: "Couldn't generate slides. Please try again." };
  }
}
