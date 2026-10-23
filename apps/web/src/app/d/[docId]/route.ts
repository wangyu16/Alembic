import { after, type NextRequest } from "next/server";
import type { PermalinkDoc } from "@/lib/permalink-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchDocBytes } from "@/lib/doc-content";
import { resolvePermalinkAccess } from "@/lib/permalink-access";
import { servePermalink } from "@/lib/permalink-response";
import { DocBytesCache } from "@/lib/doc-bytes-cache";
import { nextDocBytesLayer } from "@/lib/next-doc-bytes-layer";
import { checkRateLimit } from "@/lib/rate-limit-server";
import {
  clientIp,
  FallbackRateStore,
  MemoryRateStore,
  PostgresRateStore,
  rateSecret,
} from "@/lib/rate-limit";
import { isFirstView } from "@/lib/view-dedupe";
import { recordDiscoveryEvent } from "@/lib/record-discovery-event";
import { registerChanges } from "@/lib/register";
import { isBinaryPath } from "@/lib/collection-upload";

export const dynamic = "force-dynamic";

/**
 * P1 — the thin permalink resolver (`/d/{docId}`, contract v2 §9).
 * Permalinks are IDs, not paths: the `documents` registry maps a docId to its
 * current location, so links survive rename/move. Deliberately a small route
 * over the registry — not standing infrastructure.
 *
 * Resolution (permalinks-and-registration.md §3; decision table in
 * `lib/permalink-access.ts`, shared with includes):
 * - tombstoned            → 410 with a small educator-language page
 * - private space/repo    → owner-only (signed-in session); others see 404
 * - any file of a TRIAL   → owner-only too (S1, 2026-10-23)
 * - public + published    → platform-served from the public repo with the
 *                           correct MIME (raw GitHub is an internal transport)
 * - `@{version}` pins     → served when the pin matches the CURRENT version;
 *                           older pins need the version store (R3)
 *
 * Caching (Phase 5 Track A.6, `lib/permalink-response.ts`): public answers
 * carry an ETag of the registry hash, answer 304 without touching GitHub,
 * pinned ones are immutable in the browser, and no shared cache keeps any
 * answer longer than the 300 s takedown bound (`TAKEDOWN_BOUND_SECONDS`);
 * their bytes are cached per (docId, hash) so GitHub is read once per
 * version. Owner-only answers stay `private, no-store`.
 * Rate limited per client IP (`lib/rate-limit.ts`).
 *
 * Anonymous access to published public files needs the service client
 * (registry RLS is owner-only in MVP); without SUPABASE_SECRET_KEY the resolver
 * still works for signed-in owners via their session.
 */

const VIEWED_DOCUMENT = /\.(md\.html|slides\.html|paged\.html|html|md)$/i;

/** One per server instance: GitHub bytes per (docId, source hash). */
const bytesCache = new DocBytesCache({ shared: nextDocBytesLayer });

/**
 * A served file whose current bytes no longer match its registry row (loop
 * r2, P5.A.6.o): re-register just that file, after the response, best-effort.
 * At most once per doc per verification window on this instance, so a
 * registration that keeps failing does not turn every view into a write.
 */
const staleFiredAt = new Map<string, number>();
function reRegisterStale(doc: PermalinkDoc, bytes: Buffer): void {
  const now = Date.now();
  const last = staleFiredAt.get(doc.doc_id);
  if (last !== undefined && now - last < DocBytesCache.REVALIDATE_MS) return;
  if (staleFiredAt.size >= 10_000) staleFiredAt.clear();
  staleFiredAt.set(doc.doc_id, now);

  const work = async () => {
    const service = createServiceClient();
    if (!service) return;
    // The content as the registration hashes it: UTF-8 text, base64 for a binary.
    const content = bytes.toString(isBinaryPath(doc.path) ? "base64" : "utf8");
    await registerChanges(
      service,
      doc.package_id,
      [{ repo: doc.repo, path: doc.path, content }],
      "external-commit",
    );
  };
  const run = () =>
    work().catch((err) =>
      console.warn("[permalink] re-registration failed:", err instanceof Error ? err.message : err),
    );
  try {
    after(run);
  } catch {
    // Outside a request scope (`after` unavailable): fire and forget.
    void run();
  }
}

/** In-process fallback of the view de-duplication counter (bounded). */
const viewMemory = new MemoryRateStore(20_000);

/** First view of this doc from this address this hour? (`lib/view-dedupe.ts`) */
function firstViewThisHour(docId: string, headers: Pick<Headers, "get">): Promise<boolean> {
  const service = createServiceClient();
  const store = service ? new FallbackRateStore(new PostgresRateStore(service), viewMemory) : viewMemory;
  return isFirstView(store, docId, clientIp(headers), rateSecret());
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  // Decoded inside `servePermalink`, after the rate limit: a malformed
  // escape answers like a missing doc (security loop r1, L1).
  const raw = (await params).docId;
  const session = await createSupabaseServerClient();

  return servePermalink(raw, req.headers, {
    rateLimit: () => checkRateLimit("permalink", req.headers),
    access: (docId) =>
      resolvePermalinkAccess(docId, { session, service: createServiceClient() }),
    readBytes: (doc, ok) => fetchDocBytes(ok.db, doc),
    cache: bytesCache,
    onStale: reRegisterStale,
    // A view event per DOCUMENT opened (not per embedded figure, which
    // would multiply one reading by its image count). CDN-served views never
    // reach here, so these count origin answers, not readers — and at most
    // one per (doc, address, hour), so busting the CDN with `?x=n` cannot
    // grow research_events (security loop r1, L4b). The query string plays
    // no part in the answer: nothing here reads it.
    onPublicServed: ({ doc, pinned, status }) => {
      if (!VIEWED_DOCUMENT.test(doc.path)) return;
      recordDiscoveryEvent(
        {
          type: "element.viewed",
          packageId: doc.package_id,
          kind: VIEWED_DOCUMENT.exec(doc.path)?.[1] ?? null,
          permalinkClass: "document",
          pinned,
          revalidated: status === 304,
        },
        { session, gate: () => firstViewThisHour(doc.doc_id, req.headers) },
      );
    },
  });
}
