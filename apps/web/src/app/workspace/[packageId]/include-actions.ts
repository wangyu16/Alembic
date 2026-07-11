"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveIncludeUrl } from "@/lib/resolve-includes";

/**
 * Resolve one web-transclusion URL (`{{md-include https://…}}`) for a hosted
 * in-file editor's PREVIEW, over the `orz-host-include@1` bridge. Bounded to the
 * app's own permalink host (SSRF guard, in `resolveIncludeUrl`); the fetch is
 * unauthenticated, so private permalinks return 404 → null (never leaked).
 * Returns the markdown, or null when it can't/shouldn't resolve.
 *
 * Sign-in gated: this action drives server-side fetches, so it's for authors in
 * the workspace only — an anonymous caller can't use it to make the server
 * fetch app-host URLs on their behalf.
 */
export async function resolveIncludeAction(url: string): Promise<string | null> {
  if (typeof url !== "string" || !url) return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return resolveIncludeUrl(url);
}
