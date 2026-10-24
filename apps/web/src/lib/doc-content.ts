import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPublicRepoBytes } from "@alembic/github-bridge";
import { isBinaryPath } from "@/lib/collection-upload";
import { loadRecordedPublicRepo } from "@/lib/recorded-repo";

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
  // The repository the publish path recorded (service-role column), never
  // the owner-writable manifest.publicRepo (security loop r2, P5.S.3.e).
  const pkg = await loadRecordedPublicRepo(db, doc.package_id);
  if (!pkg.found) return null;

  if (pkg.published && doc.repo === "public" && pkg.repo) {
    // Raw bytes from the public repo — correct for both text and binary.
    const bytes = await fetchPublicRepoBytes(
      { owner: pkg.repo.owner, repo: pkg.repo.name },
      doc.path,
    ).catch(() => null);
    if (bytes) return Buffer.from(bytes);
  }

  return fetchMirrorBytes(db, doc);
}

/**
 * The file's bytes from the package store (`sandbox_files`): the trial
 * store, or a published package's mirror — which the write path updates
 * after its commit. `/d` serves a pinned version from here while the raw
 * GitHub CDN still lags a save (closed loop r3, P5.A.6.p).
 */
export async function fetchMirrorBytes(
  db: SupabaseClient,
  doc: { package_id: string; repo: "public" | "private"; path: string },
): Promise<Buffer | null> {
  // Binary is stored base64, text as UTF-8 — decode accordingly.
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
