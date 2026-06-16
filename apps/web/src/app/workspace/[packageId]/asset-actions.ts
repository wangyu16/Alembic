"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { listAssets, readAsset, writeAsset, type AssetInfo } from "@alembic/package-ops";
import { suggestStructureAltText } from "@alembic/ai-assist";
import { getKind } from "@alembic/carriers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { syncFilesToGitHub } from "@/lib/github";
import { governedProvider, RateLimitError } from "@/lib/ai";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

/** Conventional sub-directory under `materials/` per asset kind. */
const ASSET_DIR: Record<string, string> = { ketcher: "structures", plot: "plots" };

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s || "asset";
}

export interface SaveAssetInput {
  /** Carrier kind id ("ketcher" | "plot" | …). */
  kind: string;
  /** Existing repo-relative path (edit), or undefined to mint one from `name`. */
  path?: string;
  name?: string;
  /** Editable source to embed (KetJSON, Plotly spec, …). */
  source: string;
  /** Rendered SVG the carrier displays. */
  svg: string;
  /** Accessibility description (required for assets). */
  altText: string;
}

export interface SaveAssetResult {
  ok: boolean;
  path?: string;
  altText?: string;
  error?: string;
}

/**
 * Write any carrier asset (M11.1 / M11b) — kind-agnostic, so a new kind reuses
 * this with no new server code. `writeAsset` embeds the source and validates
 * placement (public `materials/`, registered kind) before any write.
 */
export async function saveAssetAction(
  packageId: string,
  input: SaveAssetInput,
): Promise<SaveAssetResult> {
  const { supabase, user } = await requireUser();
  if (!input.svg.trim() || !input.source.trim()) {
    return { ok: false, error: "Nothing to save yet." };
  }
  if (!input.altText.trim()) {
    return { ok: false, error: "Add a short description (alt text) before saving." };
  }
  const kind = getKind(input.kind);
  if (!kind) return { ok: false, error: `Unknown asset type "${input.kind}".` };

  const store = new SupabaseSandboxStore(supabase);
  try {
    const dir = ASSET_DIR[input.kind] ?? "figures";
    const path =
      input.path ?? `materials/${dir}/${slugify(input.name ?? input.kind)}${kind.extension}`;
    const { carrier } = await writeAsset(store, packageId, {
      path,
      rendered: input.svg,
      source: input.source,
    });
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path, content: carrier }],
      `Save ${input.kind} asset (Alembic)`,
    );
    await supabaseEventLogger(supabase).log({
      type: "artifact.generated",
      userId: user.id,
      packageId,
      detail: { kind: input.kind, path },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, path, altText: input.altText };
  } catch (e) {
    const error =
      e instanceof Error && e.message.includes("materials")
        ? e.message
        : "Couldn't save the asset. Please try again.";
    return { ok: false, error };
  }
}

/** List the package's reusable carrier assets for the insert picker (M11.2). */
export async function listAssetsAction(packageId: string): Promise<AssetInfo[]> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  return listAssets(store, packageId);
}

export interface ReadAssetResult {
  ok: boolean;
  source?: string;
  error?: string;
}

/** Read a carrier asset's embedded source so the editor can re-open it. */
export async function readAssetAction(
  packageId: string,
  path: string,
): Promise<ReadAssetResult> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const { source } = await readAsset(store, packageId, path);
    return { ok: true, source };
  } catch {
    return { ok: false, error: "Couldn't open that asset." };
  }
}

export interface AltTextResult {
  ok: boolean;
  altText?: string;
  error?: string;
}

/**
 * Generate chemistry-first alt text for a structure's source (M11.4). The
 * caller reviews it before it lands on the asset/reference (Tier-2 spirit:
 * AI text is proposed, the educator confirms).
 */
export async function suggestStructureAltTextAction(
  packageId: string,
  source: string,
  context?: string,
): Promise<AltTextResult> {
  const { supabase, user } = await requireUser();
  if (!source.trim()) return { ok: false, error: "No structure to describe yet." };
  try {
    const provider = governedProvider(supabase, {
      userId: user.id,
      packageId,
      kind: "a11y-fix",
    });
    const { altText } = await suggestStructureAltText(provider, { source, context });
    return { ok: true, altText };
  } catch (e) {
    if (e instanceof RateLimitError) return { ok: false, error: e.message };
    return { ok: false, error: "Couldn't generate a description. Please try again." };
  }
}
