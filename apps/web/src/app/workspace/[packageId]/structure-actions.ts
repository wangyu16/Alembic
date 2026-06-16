"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeAsset } from "@alembic/package-ops";
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

/** Slugify a human name into a safe, lowercase, hyphenated file stem. */
function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "structure";
}

export interface SaveStructureInput {
  /** Existing repo-relative path (edit), or a human name (create). */
  path?: string;
  name?: string;
  /** Editable source (KetJSON) from the editor. */
  source: string;
  /** The rendered SVG the carrier displays. */
  svg: string;
  /** Accessibility description (required for assets). */
  altText: string;
}

export interface SaveStructureResult {
  ok: boolean;
  /** Repo-relative path of the saved carrier (for inserting a reference). */
  path?: string;
  altText?: string;
  error?: string;
}

/**
 * Write a chemical-structure carrier (`materials/structures/<slug>.ketcher.svg`)
 * as a reusable asset (M11.1). The editor produces both the editable source
 * (KetJSON) and the rendered SVG; `writeAsset` embeds the source and validates
 * placement (public `materials/`, registered kind) before any write.
 */
export async function saveStructureAssetAction(
  packageId: string,
  input: SaveStructureInput,
): Promise<SaveStructureResult> {
  const { supabase, user } = await requireUser();
  if (!input.svg.trim() || !input.source.trim()) {
    return { ok: false, error: "Draw a structure before saving." };
  }
  if (!input.altText.trim()) {
    return { ok: false, error: "Add a short description (alt text) before saving." };
  }
  const store = new SupabaseSandboxStore(supabase);
  try {
    const path =
      input.path ?? `materials/structures/${slugify(input.name ?? "structure")}.ketcher.svg`;
    const { carrier } = await writeAsset(store, packageId, {
      path,
      rendered: input.svg,
      source: input.source,
    });
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path, content: carrier }],
      "Save chemical structure (Alembic)",
    );
    await supabaseEventLogger(supabase).log({
      type: "artifact.generated",
      userId: user.id,
      packageId,
      detail: { kind: "structure", path },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, path, altText: input.altText };
  } catch (e) {
    const error =
      e instanceof Error && e.message.includes("materials")
        ? e.message
        : "Couldn't save the structure. Please try again.";
    return { ok: false, error };
  }
}
