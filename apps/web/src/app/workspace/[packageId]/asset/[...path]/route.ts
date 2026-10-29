import { can, normalizePath, type Role } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { courseRepo } from "@/lib/course-v3";
import { assetContentType } from "@/lib/course-assets";

export const dynamic = "force-dynamic";
const MAX_BYTES = 15 * 1024 * 1024;

/** A course file (image or PDF) for the course's own members, from the working repo's head (RC.9). */
export async function GET(_req: Request, { params }: { params: Promise<{ packageId: string; path: string[] }> }) {
  const { packageId, path: parts } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  const { data: roleRaw } = await supabase.rpc("course_role", { p: packageId });
  if (!roleRaw) return new Response(null, { status: 404 });
  let path: string;
  try { path = normalizePath(parts.map(decodeURIComponent).join("/")); } catch { return new Response(null, { status: 404 }); }
  const type = assetContentType(path);
  if (!type) return new Response(null, { status: 404 });
  if (path.startsWith("private/") && !can(roleRaw as Role, "edit.private")) return new Response(null, { status: 404 });
  const c = await courseRepo(packageId);
  if (!c) return new Response(null, { status: 503 });
  const coords = { owner: c.owner, repo: c.name };
  const bytes = await c.client.getFileBytesAtRef(coords, path, await c.repo.head()).catch(() => null);
  if (!bytes || bytes.length > MAX_BYTES) return new Response(null, { status: 404 });
  const headers: Record<string, string> = {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=300",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  };
  return new Response(Buffer.from(bytes), { headers });
}
