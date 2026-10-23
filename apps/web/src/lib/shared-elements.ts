import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Discover's Elements scope (P2): files an educator explicitly shared ("share
 * this"). Phase 5 Track 0.3 (S2): the listing showed every `discoverable` row,
 * including files of ARCHIVED packages and of TRIAL (unpublished) packages —
 * whose permalinks are owner-only (S1) — so it must list only:
 *
 *  - shared (`discoverable`) and not tombstoned,
 *  - in the PUBLIC repo, outside the never-shareable spaces (`private`,
 *    `current`),
 *  - of a PUBLISHED package (`storage = 'github'`) that is not archived.
 *
 * The rule is applied twice: in the query (an inner join on `packages`, so the
 * page limit counts only listable rows) and again over the returned rows with
 * `isListableElement` (defence in depth — a query regression cannot list a
 * trial or private file). Track A replaces this with the discovery projection;
 * keep it small until then.
 *
 * Pure apart from the injected (service) client — unit-tested in
 * `shared-elements.adversarial.test.ts`.
 */

export interface SharedElementRow {
  doc_id: string;
  package_id: string;
  repo: string;
  space: string;
  path: string;
  kind: string;
  description: string | null;
  alt_text: string | null;
  discoverable: boolean;
  tombstoned: boolean;
  packages: { title: string; storage: string; archived_at: string | null } | null;
}

export interface SharedElement {
  doc_id: string;
  package_id: string;
  path: string;
  kind: string;
  description: string | null;
  alt_text: string | null;
  packageTitle: string;
}

const NEVER_LISTED_SPACES = new Set(["private", "current"]);

export const SHARED_ELEMENTS_LIMIT = 200;

/** True only for a shared public file of a published, active package. */
export function isListableElement(row: SharedElementRow): boolean {
  const pkg = row.packages;
  return (
    row.discoverable === true &&
    row.tombstoned === false &&
    row.repo === "public" &&
    !NEVER_LISTED_SPACES.has(row.space) &&
    pkg !== null &&
    pkg.storage === "github" &&
    pkg.archived_at === null
  );
}

/** The Elements listing, newest first. Needs the service client (registry RLS
 *  is owner-only); an error yields an empty list (discovery is best-effort). */
export async function listSharedElements(
  service: SupabaseClient,
  limit = SHARED_ELEMENTS_LIMIT,
): Promise<SharedElement[]> {
  const { data, error } = await service
    .from("documents")
    .select(
      "doc_id, package_id, repo, space, path, kind, description, alt_text, discoverable, tombstoned, packages!inner(title, storage, archived_at)",
    )
    .eq("discoverable", true)
    .eq("tombstoned", false)
    .eq("repo", "public")
    .not("space", "in", "(private,current)")
    .eq("packages.storage", "github")
    .is("packages.archived_at", null)
    .order("registered_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as SharedElementRow[]).filter(isListableElement).map((r) => ({
    doc_id: r.doc_id,
    package_id: r.package_id,
    path: r.path,
    kind: r.kind,
    description: r.description,
    alt_text: r.alt_text,
    packageTitle: r.packages?.title ?? "a course package",
  }));
}
