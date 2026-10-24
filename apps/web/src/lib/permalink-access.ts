import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The ONE access check behind a `/d/{docId}` permalink (permalinks spec §3),
 * shared by the resolver route and server-side include resolution.
 *
 * | File state                         | Who may read it                       |
 * |------------------------------------|---------------------------------------|
 * | public repo of a published package | anyone                                |
 * | public space of a TRIAL package    | the owner only (signed-in session)    |
 * | private repo                       | the owner only — and never as an      |
 * |                                    | include (`allowPrivate: false`)       |
 * | tombstoned                         | anyone sees "removed" (410)           |
 *
 * A trial package (`packages.storage = 'sandbox'`) has not been published:
 * its files live only in the platform, and serving them to anonymous readers
 * (as the resolver did before 2026-10-23, Phase 5 Track 0.2 / S1) let anyone
 * holding a docId read an unpublished course. Ownership is proven the same
 * way as for private files: the visitor's OWN session can read the registry
 * row (RLS is owner-only), so no app code compares user ids.
 *
 * Pure apart from the two injected clients — no `server-only`, no `@/` paths —
 * so the decision table is unit-tested (`permalink-access.adversarial.test.ts`).
 */

export interface PermalinkDoc {
  doc_id: string;
  package_id: string;
  repo: "public" | "private";
  path: string;
  /** The 32-bit FNV-1a identity hash (registry-internal; legacy 8-hex pins). */
  source_hash: string | null;
  /** SHA-256 of the stored content (64 hex): the version `/d` serves, labels,
   *  caches and pins by (owner decision 2026-10-24, P5.S.L2). Null on a row
   *  registered before 0027 and not re-registered since — healed on view. */
  content_sha256: string | null;
  tombstoned: boolean;
}

export type PermalinkAccess =
  | {
      status: "ok";
      doc: PermalinkDoc;
      /** The client that located the row (for reading the bytes). */
      db: SupabaseClient;
      /** True when only the owner may read it (private, or a trial package):
       *  the response must not be cached by shared caches or shared cross-origin. */
      ownerOnly: boolean;
    }
  | { status: "gone" }
  | { status: "not-found" };

export interface PermalinkClients {
  /** The visitor's session client (RLS: owner-only rows). */
  session: SupabaseClient;
  /** The service client (bypasses RLS), or null when not configured. */
  service: SupabaseClient | null;
}

/** THE docId shape, shared with the registry, the cursor and import (P5.B.1.o). */
export { DOC_ID_PATTERN } from "@alembic/package-contract";
import { DOC_ID_PATTERN, VERSION_PIN_PATTERN, pinForm } from "@alembic/package-contract";

export async function resolvePermalinkAccess(
  docId: string,
  { session, service }: PermalinkClients,
  { allowPrivate = true }: { allowPrivate?: boolean } = {},
): Promise<PermalinkAccess> {
  if (!DOC_ID_PATTERN.test(docId)) return { status: "not-found" };

  // Prefer the service client (anonymous access to public files); fall back to
  // the visitor's session (owners can always resolve their own files).
  const db = service ?? session;

  const { data } = await db
    .from("documents")
    .select("doc_id, package_id, repo, path, source_hash, content_sha256, tombstoned")
    .eq("doc_id", docId)
    .maybeSingle();
  const doc = data as PermalinkDoc | null;
  if (!doc) return { status: "not-found" };
  if (doc.tombstoned) return { status: "gone" };

  if (doc.repo === "private" && !allowPrivate) return { status: "not-found" };

  const { data: pkg } = await db
    .from("packages")
    .select("storage")
    .eq("id", doc.package_id)
    .maybeSingle();
  if (!pkg) return { status: "not-found" };
  const published = (pkg as { storage?: string }).storage === "github";

  // Private files and every file of an unpublished (trial) package: only the
  // owner, proven by their own session's RLS. Everyone else gets the same 404
  // as a missing doc (no existence oracle).
  const ownerOnly = doc.repo === "private" || !published;
  if (ownerOnly) {
    const { data: own } = await session
      .from("documents")
      .select("doc_id")
      .eq("doc_id", docId)
      .maybeSingle();
    if (!own) return { status: "not-found" };
  }

  return { status: "ok", doc, db, ownerOnly };
}

/**
 * Does a `/d/{docId}@{pin}` pin name this file's CURRENT version, and in which
 * form? (Security loop r2, NEW-3: only an exact match to a KNOWN hash — a row
 * without one satisfies no pin.)
 *
 * - `"sha256"` — the pin is the full SHA-256 of the current content
 *   (`content_sha256`). The form every new link uses (owner decision
 *   2026-10-24, P5.S.L2): collision-resistant, so the bytes `/d` serves under
 *   it — which must hash to it — are the version the link was made for.
 * - `"legacy"` — the pin is the 8-hex FNV `source_hash` links carried before
 *   2026-10-24. It still resolves, but ONLY to the current version, only when
 *   that version has a SHA-256 to check the bytes against (the caller serves
 *   nothing that does not hash to it), and never as an immutable answer: a
 *   32-bit FNV match proves nothing about the bytes (second preimages are
 *   cheap — /tmp/alembic-r4/forge.test.ts).
 * - `null` — no match: an older version, a malformed pin, or a row without
 *   the hash the pin needs.
 */
export function matchPin(
  pin: string,
  doc: Pick<PermalinkDoc, "source_hash" | "content_sha256">,
): "sha256" | "legacy" | null {
  const sha = typeof doc.content_sha256 === "string" && VERSION_PIN_PATTERN.test(doc.content_sha256)
    ? doc.content_sha256
    : null;
  const form = pinForm(pin);
  if (form === "sha256") return sha !== null && pin === sha ? "sha256" : null;
  if (form === "legacy") {
    return sha !== null && typeof doc.source_hash === "string" && pin === doc.source_hash ? "legacy" : null;
  }
  return null;
}
