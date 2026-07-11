"use server";

import { resolveIncludeUrl } from "@/lib/resolve-includes";

/**
 * Resolve one web-transclusion URL (`{{md-include https://…}}`) for a hosted
 * in-file editor's PREVIEW, over the `orz-host-include@1` bridge. Bounded to the
 * app's own permalink host (SSRF guard, in `resolveIncludeUrl`); the fetch is
 * unauthenticated, so private permalinks return 404 → null (never leaked).
 * Returns the markdown, or null when it can't/shouldn't resolve.
 */
export async function resolveIncludeAction(url: string): Promise<string | null> {
  if (typeof url !== "string" || !url) return null;
  return resolveIncludeUrl(url);
}
