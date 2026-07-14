import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPublicRepoBytes } from "@alembic/github-bridge";
import { isBinaryPath } from "@/lib/collection-upload";

/**
 * Fetch a registered file's stored BYTES, wherever they live — the shared
 * primitive behind the `/d/{docId}` permalink resolver and file-level
 * adaptation (P4). Published packages serve from the public GitHub repo
 * (tokenless; the content is genuinely public); trial/sandbox packages serve
 * from `sandbox_files`. Returns null if the package or file can't be read.
 *
 * Returns a `Buffer` of the true bytes — NOT a string: a binary asset (image,
 * PDF) must not be UTF-8-decoded (from GitHub) or served as its base64 text
 * (from the sandbox), both of which corrupt it. Text callers do `.toString("utf8")`.
 * The caller supplies the db client (service client for anonymous/cross-owner
 * reads, or the visitor's session for their own files) and the located doc.
 */
export async function fetchDocBytes(
  db: SupabaseClient,
  doc: { package_id: string; repo: "public" | "private"; path: string },
): Promise<Buffer | null> {
  const { data: pkg } = await db
    .from("packages")
    .select("storage, manifest")
    .eq("id", doc.package_id)
    .maybeSingle();
  if (!pkg) return null;

  const publicRepo = (pkg.manifest as { publicRepo?: { owner: string; name: string } })
    ?.publicRepo;

  if (pkg.storage === "github" && doc.repo === "public" && publicRepo) {
    // Raw bytes from the public repo — correct for both text and binary.
    const bytes = await fetchPublicRepoBytes(
      { owner: publicRepo.owner, repo: publicRepo.name },
      doc.path,
    ).catch(() => null);
    if (bytes) return Buffer.from(bytes);
  }

  // Sandbox fallback: binary is stored base64, text as UTF-8 — decode accordingly.
  const { data: file } = await db
    .from("sandbox_files")
    .select("content")
    .eq("package_id", doc.package_id)
    .eq("repo", doc.repo)
    .eq("path", doc.path)
    .maybeSingle();
  const content = (file as { content: string } | null)?.content ?? null;
  if (content === null) return null;
  return Buffer.from(content, isBinaryPath(doc.path) ? "base64" : "utf8");
}

/**
 * The exact bytes of a Buffer as a standalone `ArrayBuffer` — a valid `BodyInit`
 * for a `Response` (Node's `Buffer`/`Uint8Array<ArrayBufferLike>` generic isn't,
 * under the current TS lib). Slices by offset/length because a `Buffer` can be a
 * view into a larger pooled `ArrayBuffer`.
 */
export function bytesToBody(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
