import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchDocBytes } from "@/lib/doc-content";

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
 * - public + GitHub repo  → platform-served from the public repo with the
 *                           correct MIME (raw.githubusercontent is an internal
 *                           transport only — it serves text/plain + nosniff,
 *                           so self-contained HTML must be re-served, not
 *                           redirected)
 * - public + trial        → served from the sandbox store
 * - `@{version}` pins     → served when the pin matches the CURRENT version;
 *                           older pins need the version store (R3) — honest
 *                           educator-language interim message until then
 *
 * Anonymous access to public files needs the service client (registry RLS is
 * owner-only in MVP); without SUPABASE_SECRET_KEY the resolver still works for
 * signed-in owners via their session.
 */

interface DocRow {
  doc_id: string;
  package_id: string;
  repo: "public" | "private";
  path: string;
  source_hash: string | null;
  tombstoned: boolean;
}

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
  if (!/^doc-[a-z0-9]+$/.test(docId)) return notFound();

  // Prefer the service client (anonymous access to public files); fall back to
  // the visitor's session (owners can always resolve their own files).
  const session = await createSupabaseServerClient();
  const service = createServiceClient();
  const db = service ?? session;

  const { data } = await db
    .from("documents")
    .select("doc_id, package_id, repo, path, source_hash, tombstoned")
    .eq("doc_id", docId)
    .maybeSingle();
  const doc = data as DocRow | null;
  if (!doc) return notFound();

  if (doc.tombstoned) {
    return page(
      410,
      "This file was removed",
      "The educator removed this file. Its address is never reused, so this page is permanent.",
    );
  }

  // Private files: only the owner (checked via their own session, so RLS does
  // the ownership test). Everyone else sees the same 404 as a missing doc.
  if (doc.repo === "private") {
    const { data: own } = await session
      .from("documents")
      .select("doc_id")
      .eq("doc_id", docId)
      .maybeSingle();
    if (!own) return notFound();
  }

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

  return new Response(content, {
    headers: {
      "content-type": mimeFor(doc.path),
      // Live links: short cache. Pinned-and-matching: immutable.
      "cache-control":
        pin && pin === doc.source_hash
          ? "public, max-age=31536000, immutable"
          : "public, max-age=60",
      // Public objects are embeddable cross-origin (permalink-as-src).
      ...(doc.repo === "public" ? { "access-control-allow-origin": "*" } : {}),
    },
  });
}
