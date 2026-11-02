import { can, normalizePath, type Role } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { courseRepo } from "@/lib/course-v3";
import { assetContentType, assetSecret, verifyAsset } from "@/lib/course-assets";
import { githubBusy } from "@/lib/github-busy";

export const dynamic = "force-dynamic";
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * A course file (image or PDF) from the working repo's head (RC.9), for a
 * course member (session) or for an address the document page signed for a
 * member (the editor's sandboxed preview sends no session).
 */
export async function GET(req: Request, { params }: { params: Promise<{ packageId: string; path: string[] }> }) {
  const { packageId, path: parts } = await params;
  let path: string;
  try { path = normalizePath(parts.map(decodeURIComponent).join("/")); } catch { return new Response(null, { status: 404 }); }
  const type = assetContentType(path);
  if (!type) return new Response(null, { status: 404 });
  const url = new URL(req.url);
  const secret = assetSecret();
  const blob = url.searchParams.get("b");
  const signed = secret !== null && verifyAsset(secret, packageId, path, blob, url.searchParams.get("e"), url.searchParams.get("s"));
  if (!signed) {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(null, { status: 401 });
    const { data: roleRaw } = await supabase.rpc("course_role", { p: packageId });
    if (!roleRaw) return new Response(null, { status: 404 });
    if (path.startsWith("private/") && !can(roleRaw as Role, "edit.private")) return new Response(null, { status: 404 });
  }
  const c = await courseRepo(packageId);
  if (!c) return new Response(null, { status: 503 });
  const coords = { owner: c.owner, repo: c.name };
  // A signed address names the exact version (blob id): one request, and the browser may keep it (RC.9).
  let bytes: Uint8Array | null;
  try {
    bytes = signed ? await c.client.getBlob(coords, blob!) : await c.client.getFileBytesAtRef(coords, path, await c.repo.head());
  } catch (e) {
    if (githubBusy(e)) return new Response(null, { status: 503, headers: { "retry-after": "60" } });
    bytes = null;
  }
  if (!bytes || bytes.length > MAX_BYTES) return new Response(null, { status: 404 });
  const headers: Record<string, string> = {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "cache-control": signed ? "private, max-age=86400, immutable" : "private, max-age=300",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  };
  return new Response(Buffer.from(bytes), { headers });
}
