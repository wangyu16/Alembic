"use server";

import { redirect } from "next/navigation";
import { listAssets, type AssetInfo } from "@alembic/package-ops";
import { suggestStructureAltText } from "@alembic/ai-assist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { governedProvider, RateLimitError } from "@/lib/ai";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

/** List the package's reusable carrier assets for the insert picker (M11.2). */
export async function listAssetsAction(packageId: string): Promise<AssetInfo[]> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  return listAssets(store, packageId);
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
