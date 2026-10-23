import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchDocBytes, bytesToBody } from "@/lib/doc-content";
import { resolvePermalinkAccess } from "@/lib/permalink-access";

export const dynamic = "force-dynamic";

/**
 * P1 — the thin permalink resolver (`/d/{docId}`, contract v2 §9).
 * Permalinks are IDs, not paths: the `documents` registry maps a docId to its
 * current location, so links survive rename/move. Deliberately a small route
 * over the registry — not standing infrastructure.
 *
 * Resolution (permalinks-and-registration.md §3):
 * - tombstoned            → 410 with a small educator-language page
 * - private space/repo    → owner-only (signed-in session); others see 404
 * - any file of a TRIAL   → owner-only too (S1, 2026-10-23): an unpublished
 *   (sandbox) package       course is not public; served from the sandbox
 *                           store to its owner only. The decision table lives
 *                           in `lib/permalink-access.ts` (shared with includes)
 * - public + GitHub repo  → platform-served from the public repo with the
 *                           correct MIME (raw.githubusercontent is an internal
 *                           transport only — it serves text/plain + nosniff,
 *                           so self-contained HTML must be re-served, not
 *                           redirected)
 * - `@{version}` pins     → served when the pin matches the CURRENT version;
 *                           older pins need the version store (R3) — honest
 *                           educator-language interim message until then
 *
 * Anonymous access to published public files needs the service client
 * (registry RLS is owner-only in MVP); without SUPABASE_SECRET_KEY the resolver
 * still works for signed-in owners via their session.
 */

const MIME: Array<[RegExp, string]> = [
  [/\.(md\.html|slides\.html|paged\.html|html)$/i, "text/html; charset=utf-8"],
  [/\.svg$/i, "image/svg+xml"],
  [/\.png$/i, "image/png"],
  [/\.jpe?g$/i, "image/jpeg"],
  [/\.gif$/i, "image/gif"],
  [/\.webp$/i, "image/webp"],
  [/\.pdf$/i, "application/pdf"],
  [/\.(mp3)$/i, "audio/mpeg"],
  [/\.(wav)$/i, "audio/wav"],
  [/\.(m4a)$/i, "audio/mp4"],
  [/\.(ogg|oga)$/i, "audio/ogg"],
  // Video — so an inserted `<video src="/d/{docId}">` resolves.
  [/\.mp4$/i, "video/mp4"],
  [/\.webm$/i, "video/webm"],
  [/\.mov$/i, "video/quicktime"],
  [/\.m4v$/i, "video/mp4"],
  [/\.ogv$/i, "video/ogg"],
  [/\.json$/i, "application/json; charset=utf-8"],
  [/\.md$/i, "text/markdown; charset=utf-8"],
];

function mimeFor(path: string): string {
  for (const [re, type] of MIME) if (re.test(path)) return type;
  return "text/plain; charset=utf-8";
}

/** Active-content classes: self-contained HTML documents and SVG objects. */
const ACTIVE_CONTENT = /\.(md\.html|slides\.html|paged\.html|html|svg)$/i;

/**
 * Security headers for served content. Self-contained documents legitimately
 * carry their own scripts (the orz runtime renders the deck/markdown island),
 * so we can't strip script — but a public permalink is on the SAME origin as
 * the authenticated workspace. We serve active content in a CSP `sandbox` with
 * `allow-scripts` but deliberately WITHOUT `allow-same-origin`: the file still
 * runs and renders, but in an OPAQUE origin — it can't read the viewer's
 * Alembic session cookies or call their Server Actions. That closes cross-user
 * stored XSS via a shared `/d/{docId}` link (and the `adaptElementAction` SVG
 * vector) without breaking the reader experience. `nosniff` pins every type so
 * a mislabeled body can't be reinterpreted as HTML.
 */
function securityHeaders(path: string): Record<string, string> {
  const h: Record<string, string> = { "x-content-type-options": "nosniff" };
  if (ACTIVE_CONTENT.test(path)) {
    h["content-security-policy"] =
      "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";
  }
  return h;
}

function page(status: number, title: string, body: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem">` +
      `<h1 style="font-size:1.2rem">${title}</h1><p>${body}</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

const notFound = () =>
  page(404, "Not found", "This link doesn't point to a shared file, or you don't have access to it.");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  // `/d/{docId}` or `/d/{docId}@{version}` — split the optional pin.
  const raw = decodeURIComponent((await params).docId);
  const at = raw.indexOf("@");
  const docId = at === -1 ? raw : raw.slice(0, at);
  const pin = at === -1 ? null : raw.slice(at + 1);

  // Who may read this file: published public → anyone; private, or any file
  // of an unpublished (trial) package → the owner's own session only.
  const access = await resolvePermalinkAccess(docId, {
    session: await createSupabaseServerClient(),
    service: createServiceClient(),
  });
  if (access.status === "not-found") return notFound();
  if (access.status === "gone") {
    return page(
      410,
      "This file was removed",
      "The educator removed this file. Its address is never reused, so this page is permanent.",
    );
  }
  const { doc, db, ownerOnly } = access;

  // Version pin: the registry holds the CURRENT version; older pins arrive
  // with R3's version store.
  if (pin && doc.source_hash && pin !== doc.source_hash) {
    return page(
      404,
      "That exact version isn't available yet",
      "This link pins an older version of the file. Version history is coming; the current version is at " +
        `<a href="/d/${docId}">this permalink</a>.`,
    );
  }

  // Fetch the bytes wherever they live (published GitHub repo vs trial
  // sandbox) — the shared primitive also backs file-level adaptation.
  const content = await fetchDocBytes(db, doc);
  if (content === null) return notFound();

  // Serve the true bytes (an ArrayBuffer BodyInit) so binary assets aren't
  // corrupted — `content` is a Buffer, not a string.
  return new Response(bytesToBody(content), {
    headers: {
      "content-type": mimeFor(doc.path),
      // Owner-only answers (private, trial) are never stored by a shared
      // cache. Public live links: short cache; pinned-and-matching: immutable.
      "cache-control": ownerOnly
        ? "private, no-store"
        : pin && pin === doc.source_hash
          ? "public, max-age=31536000, immutable"
          : "public, max-age=60",
      // Published public objects are embeddable cross-origin (permalink-as-src).
      ...(!ownerOnly ? { "access-control-allow-origin": "*" } : {}),
      ...securityHeaders(doc.path),
    },
  });
}
