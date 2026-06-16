import { layerForPath } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";

/**
 * Serve a carrier asset's file from the package store (M11.3). Used by the
 * in-app preview so an inserted `materials/…` reference renders before the
 * package is published to GitHub. Owner-only (RLS), public layer only — the
 * two-repo invariant means private files are never served here.
 *
 * The published static site references assets by their portable path/permalink
 * instead; this route is an authoring-time convenience, not a publish target.
 */

const CONTENT_TYPE: Record<string, string> = {
  svg: "image/svg+xml; charset=utf-8",
  html: "text/html; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packageId: string; path: string[] }> },
) {
  const { packageId, path: segments } = await params;
  const path = segments.join("/");

  // Only public-layer files are servable; reject anything else fail-closed.
  let layer: string | null;
  try {
    layer = layerForPath(path);
  } catch {
    return new Response("Bad path", { status: 400 });
  }
  if (layer !== "materials") return new Response("Forbidden", { status: 403 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const store = new SupabaseSandboxStore(supabase);
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === path);
  if (!file) return new Response("Not found", { status: 404 });

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPE[ext] ?? "application/octet-stream";
  return new Response(file.content, {
    headers: {
      "content-type": contentType,
      // Authoring preview only; never cache across edits.
      "cache-control": "no-store",
    },
  });
}
