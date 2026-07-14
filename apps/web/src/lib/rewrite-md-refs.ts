import type { SupabaseClient } from "@supabase/supabase-js";
import { rewriteRelativeRefs } from "@alembic/package-ops";
import { SupabaseDocumentRegistryStore } from "@/lib/document-registry-store";
import { appBaseUrl } from "@/lib/app-url";

/**
 * Rewrite a plain-markdown document's relative asset references to permalinks
 * (U3): `![](../assets/x.svg)` → `![](https://…/d/{docId})`, so a cross-reference
 * survives the document being moved and still resolves in a downloaded copy or on
 * the published site — matching what "Insert" bakes in. Best-effort and
 * non-destructive: only `.md` content is touched, only references that resolve to
 * a REGISTERED asset in the same repo are rewritten, and it no-ops when the app
 * origin isn't configured (`NEXT_PUBLIC_APP_URL`). Carriers keep their own refs;
 * binaries are never markdown.
 *
 * Shared by the in-workspace write paths (insert / upload / replace) and the
 * whole-package populate path, so an offline-authored package's `../assets/…`
 * refs resolve exactly the same way a hand-authored one's do. The asset must be
 * registered first (populate commits + `syncPackageRegistry` before calling this).
 */
export async function rewriteMarkdownRefs(
  supabase: SupabaseClient,
  packageId: string,
  repo: "public" | "private",
  path: string,
  content: string,
): Promise<string> {
  if (!path.toLowerCase().endsWith(".md")) return content;
  const base = appBaseUrl();
  if (!base) return content;
  const registry = new SupabaseDocumentRegistryStore(supabase);
  return rewriteRelativeRefs(content, path, async (repoPath) => {
    const rec = await registry.getByLocation(packageId, repo, repoPath);
    return rec ? `${base}/d/${rec.docId}` : null;
  });
}
