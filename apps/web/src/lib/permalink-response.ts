/**
 * The `/d/{docId}` answer (permalinks spec §3), separated from the route so
 * the caching rules are unit-tested against the real access check
 * (`permalink-response.adversarial.test.ts`). Phase 5 Track A.6.
 *
 * Order matters, and is the security argument:
 *  1. rate limit (per client IP) — before any lookup;
 *  2. the ONE access check (`lib/permalink-access.ts`) — before anything that
 *     depends on the file: no 304, no ETag and no cache lookup can happen for
 *     a file the visitor may not read, so neither can reveal that it exists;
 *  3. owner-only answers (private repo, trial package) — fetched fresh,
 *     `private, no-store`, no ETag, no 304, no CORS, never in a shared cache;
 *  4. public answers — keyed by the registry's `source_hash`:
 *       ETag `W/"{hash}"`; `If-None-Match` → 304 without reading GitHub;
 *       pinned `@{hash}` → `immutable` for a year in the BROWSER only,
 *       shared caches (CDN) at most `TAKEDOWN_BOUND_SECONDS` (300 s);
 *       live → browser 60 s, CDN 240 s + 60 s stale-while-revalidate;
 *       bytes from `DocBytesCache` (GitHub read once per version; an
 *       unpinned answer re-verifies the hash against the current bytes at
 *       most once per 60 s window — loop r2, P5.A.6.o).
 *     Bytes that do not hash to the registry's hash (the repo moved ahead of
 *     the registry, or the raw CDN lags a save) are served unlabelled: no
 *     ETag, `private, no-store` (`CACHE.unverified`), not cached, and
 *     `onStale` asks for that one row to be healed — from the mirror, never
 *     from these bytes (closed loop r3, P5.A.6.p; `lib/permalink-heal.ts`).
 *
 * The ETag is WEAK because for carrier files the hash covers the embedded
 * source, not the rendered bytes: two renderings of one source are the same
 * version, not the same bytes.
 */

import type { PermalinkAccess, PermalinkDoc } from "./permalink-access";
import { pinSatisfied } from "./permalink-access";
import { bytesMatchHash, type DocBytesCache } from "./doc-bytes-cache";
import type { RateDecision } from "./rate-limit";
import { tooManyRequests } from "./rate-limit";

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

export function mimeFor(path: string): string {
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
export function securityHeaders(path: string): Record<string, string> {
  const h: Record<string, string> = { "x-content-type-options": "nosniff" };
  if (ACTIVE_CONTENT.test(path)) {
    h["content-security-policy"] =
      "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";
  }
  return h;
}

/**
 * The takedown bound (security loop r1, M3): the longest any SHARED cache — the
 * CDN, or a proxy between a reader and us — may keep serving a `/d` answer,
 * counting stale-while-revalidate / stale-if-error windows. A file that is
 * removed (410), made private, or taken back to trial stops being served
 * everywhere within this many seconds. Every policy below stays within it;
 * `permalink-response.cache-bound.test.ts` checks every answer kind.
 */
export const TAKEDOWN_BOUND_SECONDS = 300;

/** Cache policies, named so tests and docs quote one source. */
export const CACHE = {
  ownerOnly: "private, no-store",
  /**
   * Pinned `@{hash}`: the BROWSER keeps its own copy a year (`private`, so no
   * shared cache may store it under this header) — a reader's private copy of
   * a version they already saw is acceptable after a takedown. Shared caches
   * get `CDN_CACHE.pinned` instead: at most the takedown bound.
   */
  pinned: "private, max-age=31536000, immutable",
  /** Browser 60 s; shared caches 240 s fresh + 60 s stale = the takedown bound. */
  live: "public, max-age=60, s-maxage=240, stale-while-revalidate=60",
  /**
   * Bytes we could not tie to the registry's hash (no ETag): never stored by
   * a shared cache or kept by the browser (closed loop r3, P5.A.6.q). They
   * may be a lagging CDN's previous version or a commit the registry has not
   * seen; a shared copy would outlive the fix and carry no version to
   * revalidate against.
   */
  unverified: "private, no-store",
  /** Not found / no access: never stored, so an owner never sees a cached 404. */
  none: "no-store",
  /** Tombstones are permanent (docIds are never reused): browsers keep them an
   *  hour, shared caches no longer than the takedown bound. */
  gone: "public, max-age=3600, s-maxage=300",
} as const;

/**
 * CDN-targeted lifetimes (RFC 9213 `CDN-Cache-Control`; Vercel's CDN honours
 * `Vercel-CDN-Cache-Control` and `CDN-Cache-Control` over `Cache-Control`).
 * Used where the browser policy is longer than the shared one: a CDN that
 * reads these keeps the answer for the takedown bound; one that does not sees
 * `private` and keeps nothing.
 */
export const CDN_CACHE = {
  pinned: `public, max-age=${TAKEDOWN_BOUND_SECONDS}`,
} as const;

/** The cache headers for a public, hash-labelled answer. */
function cacheHeaders(pinned: boolean): Record<string, string> {
  return pinned
    ? {
        "cache-control": CACHE.pinned,
        "cdn-cache-control": CDN_CACHE.pinned,
        "vercel-cdn-cache-control": CDN_CACHE.pinned,
      }
    : { "cache-control": CACHE.live };
}

function page(status: number, title: string, body: string, cache: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem">` +
      `<h1 style="font-size:1.2rem">${title}</h1><p>${body}</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache } },
  );
}

const notFound = () =>
  page(
    404,
    "Not found",
    "This link doesn't point to a shared file, or you don't have access to it.",
    CACHE.none,
  );

/** Does an `If-None-Match` header match this weak ETag (weak comparison)? */
export function etagMatches(ifNoneMatch: string | null, hash: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((t) => {
    const v = t.trim();
    return v === "*" || v.replace(/^W\//, "").replace(/^"|"$/g, "") === hash;
  });
}

export const etagFor = (hash: string) => `W/"${hash}"`;

/**
 * Percent-decode the route parameter (an encoded `@` must still split the
 * pin). A malformed escape (`%zz`, a truncated UTF-8 sequence) is null: the
 * caller answers it exactly like a missing doc, never a 500.
 */
export function decodePermalinkParam(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Split `docId` or `docId@version`. */
export function parsePermalinkParam(raw: string): { docId: string; pin: string | null } {
  const at = raw.indexOf("@");
  return at === -1 ? { docId: raw, pin: null } : { docId: raw.slice(0, at), pin: raw.slice(at + 1) };
}

export interface ServedInfo {
  doc: PermalinkDoc;
  pinned: boolean;
  status: 200 | 304;
}

export interface PermalinkDeps {
  rateLimit?: () => Promise<RateDecision>;
  access: (docId: string) => Promise<PermalinkAccess>;
  /** Read the file's bytes wherever they live (GitHub or trial store). */
  readBytes: (doc: PermalinkDoc, ok: Extract<PermalinkAccess, { status: "ok" }>) => Promise<Buffer | null>;
  cache: DocBytesCache;
  /**
   * Read the file's MIRROR copy (the package store the write path updates
   * after its commit), or null. Used only for a PINNED request whose origin
   * bytes do not hash to the pin — the raw CDN lags a save — and served only
   * if these bytes hash to the pin (closed loop r3, P5.A.6.p).
   */
  readMirror?: (doc: PermalinkDoc, ok: Extract<PermalinkAccess, { status: "ok" }>) => Promise<Buffer | null>;
  /** Called for every PUBLIC answer served (view events). Never for owner-only. */
  onPublicServed?: (info: ServedInfo) => void;
  /**
   * Called when a public file's bytes no longer hash to the registry row
   * (loop r2, P5.A.6.o) — the route heals that one row from the mirror. It
   * is deliberately NOT given the bytes: they may lag a save (raw CDN), and
   * registering them rolled the registry back (closed loop r3, P5.A.6.p).
   * Must not block; anything it throws is swallowed.
   */
  onStale?: (doc: PermalinkDoc) => void;
}

/** The exact bytes of a Buffer as a standalone ArrayBuffer (a valid BodyInit). */
function body(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * `rawParam` is the route parameter as received (still percent-encoded where
 * the address was); it is decoded here, AFTER the rate limit, so a malformed
 * address costs the caller a hit like any other request.
 */
export async function servePermalink(
  rawParam: string,
  reqHeaders: Pick<Headers, "get">,
  deps: PermalinkDeps,
): Promise<Response> {
  if (deps.rateLimit) {
    const gate = await deps.rateLimit();
    if (!gate.ok) return tooManyRequests(gate.retryAfterSeconds);
  }

  const decoded = decodePermalinkParam(rawParam);
  if (decoded === null) return notFound();
  const { docId, pin } = parsePermalinkParam(decoded);

  // Who may read this file: published public → anyone; private, or any file
  // of an unpublished (trial) package → the owner's own session only.
  const access = await deps.access(docId);
  if (access.status === "not-found") return notFound();
  if (access.status === "gone") {
    return page(
      410,
      "This file was removed",
      "The educator removed this file. Its address is never reused, so this page is permanent.",
      CACHE.gone,
    );
  }
  const { doc, ownerOnly } = access;
  const hash = doc.source_hash;

  // Version pin: the registry holds the CURRENT version; older pins arrive
  // with R3's version store.
  // A pin is satisfied only by the KNOWN current hash (loop r2, NEW-3): a
  // pin on a row without a hash is not served as the current bytes.
  if (pin !== null && !pinSatisfied(pin, hash)) {
    return page(
      404,
      "That exact version isn't available yet",
      "This link pins an older version of the file. Version history is coming; the current version is at " +
        `<a href="/d/${docId}">this permalink</a>.`,
      CACHE.none,
    );
  }
  const pinned = pin !== null;

  // ── Owner-only: fresh every time, never shared, never conditional. ──
  if (ownerOnly) {
    const bytes = await deps.readBytes(doc, access);
    if (bytes === null) return notFound();
    return new Response(body(bytes), {
      headers: {
        "content-type": mimeFor(doc.path),
        "cache-control": CACHE.ownerOnly,
        ...securityHeaders(doc.path),
      },
    });
  }

  // ── Public file of a published package. ──
  const shared = {
    // Published public objects are embeddable cross-origin (permalink-as-src).
    "access-control-allow-origin": "*",
    ...securityHeaders(doc.path),
  };

  if (!hash) {
    // No registry hash to key on (should not happen for registered files).
    const bytes = await deps.readBytes(doc, access);
    if (bytes === null) return notFound();
    deps.onPublicServed?.({ doc, pinned: false, status: 200 });
    return new Response(body(bytes), {
      headers: { "content-type": mimeFor(doc.path), "cache-control": CACHE.unverified, ...shared },
    });
  }

  const cacheControl = cacheHeaders(pinned);
  const key = { docId: doc.doc_id, hash, path: doc.path };
  const servedStale = (bytes: Buffer): Response => {
    // The bytes and the registry disagree (either may be the newer one):
    // serve what was read, unlabelled (no ETag, `private, no-store`) — as for
    // any unverified read — and ask for that one row to be healed.
    try {
      deps.onStale?.(doc);
    } catch {
      // never affects the answer
    }
    deps.onPublicServed?.({ doc, pinned: false, status: 200 });
    return new Response(body(bytes), {
      headers: { "content-type": mimeFor(doc.path), "cache-control": CACHE.unverified, ...shared },
    });
  };

  if (etagMatches(reqHeaders.get("if-none-match"), hash)) {
    // 304 only when the registry hash was verified against the file's
    // CURRENT bytes recently (loop r1b, P5.B.1.m): a stale registry row must
    // not keep every client and the CDN on the old version indefinitely.
    const check = await deps.cache.revalidate(key, () => deps.readBytes(doc, access));
    if (check === null) return notFound();
    if (check.status === "fresh") {
      deps.onPublicServed?.({ doc, pinned, status: 304 });
      return new Response(null, {
        status: 304,
        headers: { etag: etagFor(hash), ...cacheControl, ...shared },
      });
    }
    return servedStale(check.bytes);
  }

  // Unpinned (loop r2, P5.A.6.o): bytes are served under the registry hash
  // only if that hash was verified against the file's CURRENT bytes within
  // `DocBytesCache.REVALIDATE_MS` on this instance — an LRU or shared-layer
  // copy proves only that the file once had that hash. `revalidate` reads the
  // origin at most once per window and hands back what it read, so there is
  // no second read.
  //
  // Pinned `@{hash}`: no re-verification. The pin already equals the current
  // registry hash (checked above), and cached bytes are content-addressed by
  // that hash — they ARE the version the reader asked for, even if the file
  // has since moved on.
  let fresh: Buffer | undefined;
  if (!pinned) {
    const check = await deps.cache.revalidate(key, () => deps.readBytes(doc, access));
    if (check === null) return notFound();
    if (check.status === "stale") return servedStale(check.bytes);
    fresh = check.bytes;
  }

  // A pin whose origin bytes are not the pinned version (the raw CDN still
  // serves the previous one right after a save): the mirror's copy, if — and
  // only if — it hashes to the pin. Content-addressed, so the cache may keep
  // it under the pin like any verified read (closed loop r3, P5.A.6.p).
  // The mirror copy is NOT an origin verification: it licenses no 304 and no
  // unpinned label.
  let fromMirror: Buffer | null = null;
  const loadPinned = async (): Promise<Buffer | null> => {
    const origin = await deps.readBytes(doc, access);
    if (origin && bytesMatchHash(doc.path, origin, hash)) return origin;
    if (!deps.readMirror) return origin;
    const mirror = await deps.readMirror(doc, access).catch(() => null);
    if (mirror && bytesMatchHash(doc.path, mirror, hash)) return (fromMirror = mirror);
    return origin;
  };
  const got = fresh
    ? { bytes: fresh, verified: true }
    : pinned
      ? await deps.cache.get(key, loadPinned, { fromOrigin: (b) => b !== fromMirror })
      : await deps.cache.get(key, () => deps.readBytes(doc, access));
  if (got === null) return notFound();
  deps.onPublicServed?.({ doc, pinned, status: 200 });
  return new Response(body(got.bytes), {
    headers: {
      "content-type": mimeFor(doc.path),
      ...(got.verified
        ? { etag: etagFor(hash), ...cacheControl }
        : { "cache-control": CACHE.unverified }),
      ...shared,
    },
  });
}
