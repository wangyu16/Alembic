import { createHash } from "node:crypto";
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
  req: Request,
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
  // ONE row, and only ever from the PUBLIC partition.
  //
  // This route serves every image in the editor preview, which re-renders on a
  // debounce while the educator types — and it used to read the whole package
  // per request. On a real course that is ~30 MB per image, tens of times a
  // minute. Selecting the single public row also makes the two-repo invariant
  // structural rather than a post-hoc check: a private file cannot be selected
  // at all, so it can never be served here by mistake.
  const content = await store.readFile(packageId, "public", path);
  if (content === null) return new Response("Not found", { status: 404 });
  const file = { content };

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
  // Weak validator over the stored bytes: changes whenever the file does, so a
  // revalidation of an unchanged figure returns 304 with no body.
  const etag = `W/"${createHash("sha256").update(file.content).digest("hex").slice(0, 32)}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  return new Response(body, {
    headers: {
      etag,
      "content-type": contentType,
      // Authoring preview: the educator must see their own edits immediately,
      // so this can never be a long public cache. But `no-store` also forces a
      // fresh fetch of every unchanged figure on every preview re-render (which
      // fires on a debounce while typing). `no-cache` keeps correctness — the
      // browser always revalidates — while `must-revalidate` + a private scope
      // keeps it per-user; combined with the ETag below an unchanged image
      // costs a 304 instead of re-sending its bytes.
      "cache-control": "private, no-cache, must-revalidate",
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
