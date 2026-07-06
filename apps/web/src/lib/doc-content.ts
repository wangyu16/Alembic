import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPublicRepoFile } from "@alembic/github-bridge";

/**
 * Fetch a registered file's stored bytes, wherever they live — the shared
 * primitive behind the `/d/{docId}` permalink resolver and file-level
 * adaptation (P4). Published packages serve from the public GitHub repo
 * (tokenless; the content is genuinely public); trial/sandbox packages serve
 * from `sandbox_files`. Returns null if the package or file can't be read.
 *
 * The caller supplies the db client (service client for anonymous/cross-owner
 * reads, or the visitor's session for their own files) and the located doc.
 */
export async function fetchDocBytes(
  db: SupabaseClient,
  doc: { package_id: string; repo: "public" | "private"; path: string },
): Promise<string | null> {
  const { data: pkg } = await db
    .from("packages")
    .select("storage, manifest")
    .eq("id", doc.package_id)
    .maybeSingle();
  if (!pkg) return null;

  const publicRepo = (pkg.manifest as { publicRepo?: { owner: string; name: string } })
    ?.publicRepo;

  let content: string | null = null;
  if (pkg.storage === "github" && doc.repo === "public" && publicRepo) {
    // Internal transport only — the caller re-serves with the correct MIME.
    content = await fetchPublicRepoFile(
      { owner: publicRepo.owner, repo: publicRepo.name },
      doc.path,
    ).catch(() => null);
  }
  if (content === null) {
    const { data: file } = await db
      .from("sandbox_files")
      .select("content")
      .eq("package_id", doc.package_id)
      .eq("repo", doc.repo)
      .eq("path", doc.path)
      .maybeSingle();
    content = (file as { content: string } | null)?.content ?? null;
  }
  return content;
}
