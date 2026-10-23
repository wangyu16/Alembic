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
  source_hash: string | null;
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

export const DOC_ID_PATTERN = /^doc-[a-z0-9]+$/;

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
    .select("doc_id, package_id, repo, path, source_hash, tombstoned")
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
