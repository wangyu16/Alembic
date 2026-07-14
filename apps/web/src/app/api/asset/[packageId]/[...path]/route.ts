import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { isBinaryPath } from "@/lib/collection-upload";
import { bytesToBody } from "@/lib/doc-content";

/**
 * Serve a package file from the store for the in-app authoring preview — an
 * inserted `materials/…` reference, or a collection file opened from the
 * workspace (Assets / Current), before the package is published to GitHub.
 *
 * Owner-only (RLS scopes `listFiles` to the caller's own packages) and
 * PUBLIC-REPO ONLY: the served file's stored `repo` must be `"public"`. The
 * two-repo invariant guarantees `private-instructor` content lives only in the
 * private repo (`repo: "private"`), so it can never be served here — private
 * files are opened through their own editor path, never this route. (The old
 * gate checked `layerForPath === "materials"`, which threw a 400 for the v2
 * `current/` space — Open failed for term files.)
 *
 * The published static site references files by their portable path/permalink
 * instead; this route is an authoring-time convenience, not a publish target.
 */

const CONTENT_TYPE: Record<string, string> = {
  svg: "image/svg+xml; charset=utf-8",
  html: "text/html; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  pdf: "application/pdf",
  // Text-ish sources — inline so "Open" DISPLAYS them rather than downloading
  // (octet-stream would trigger a download for a `.md` announcement).
  md: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packageId: string; path: string[] }> },
) {
  const { packageId, path: segments } = await params;
  const path = segments.join("/");

  // Fail-closed on anything that could escape the package tree.
  if (!path || path.includes("..") || path.startsWith("/")) {
    return new Response("Bad path", { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const store = new SupabaseSandboxStore(supabase);
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.path === path);
  if (!file) return new Response("Not found", { status: 404 });
  // Two-repo invariant: only public-repo files are ever served here.
  if (file.repo !== "public") return new Response("Forbidden", { status: 403 });

  // Content type keys off the FINAL extension (so `.md.html` → html,
  // `.ketcher.svg` → svg), not the compound carrier extension.
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPE[ext] ?? "application/octet-stream";
  // Self-contained HTML / SVG carry scripts. This route is owner-only, but
  // `adaptElementAction` can copy a stranger's public SVG into the owner's
  // package — so serve active content in an opaque-origin sandbox (scripts run,
  // no same-origin session access). `nosniff` pins the declared type.
  const active = ext === "html" || ext === "svg";
  // Binary files (images/PDFs) are stored base64 in the sandbox — decode to real
  // bytes; serving the base64 string as the body corrupts the image. Text (md/
  // html/svg) is stored/served as-is.
  const body: ArrayBuffer | string = isBinaryPath(path)
    ? bytesToBody(Buffer.from(file.content, "base64"))
    : file.content;
  return new Response(body, {
    headers: {
      "content-type": contentType,
      // Authoring preview only; never cache across edits.
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(active
        ? {
            "content-security-policy":
              "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads",
          }
        : {}),
    },
  });
}
