/**
 * Concept-map & objectives read/write ops (the hidden planning layer).
 *
 * These records live in the PUBLIC repo (adaptable on GitHub) but are NOT
 * rendered on the student site. The schema is owned by
 * `@alembic/package-contract`; this module is pure I/O over a `PackageStore`
 * (no AI, no GitHub). Validation happens here so a malformed map/objectives is
 * rejected and never written. Mirrors the load/save pattern in `study-guide.ts`.
 */

import {
  assertPathAllowedInRepo,
  conceptMapPath,
  objectivesPath,
  ConceptMapSchema,
  ObjectivesSchema,
  type ConceptMap,
  type Objectives,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";

type Scope = "course" | "chapter";

/** A chapter-scope record needs a slug to derive its path. */
function requireSlug(scope: Scope, slug: string | undefined): void {
  if (scope === "chapter" && !slug) {
    throw new Error(
      "A chapter-scope concept map / objectives record requires a slug.",
    );
  }
}

/**
 * Load the concept map for a scope (course-wide, or a chapter by slug) from the
 * PUBLIC repo. Returns a valid empty map when the file is absent.
 */
export async function loadConceptMap(
  store: PackageStore,
  packageId: string,
  scope: Scope,
  slug?: string,
): Promise<ConceptMap> {
  requireSlug(scope, slug);
  const path = conceptMapPath(scope, slug);
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === path);
  if (!file) {
    return { scope, concepts: [] };
  }
  return ConceptMapSchema.parse(JSON.parse(file.content));
}

/**
 * Save a concept map: validate against the schema (reject malformed, never
 * repair), derive its path from `map.scope` + slug, validate the path against
 * the layer contract, then persist canonical JSON to the PUBLIC repo.
 */
export async function saveConceptMap(
  store: PackageStore,
  packageId: string,
  map: ConceptMap,
  slug?: string,
): Promise<void> {
  const parsed = ConceptMapSchema.parse(map);
  requireSlug(parsed.scope, slug);
  const path = conceptMapPath(parsed.scope, slug);
  assertPathAllowedInRepo(path, "public");
  await store.putFiles(packageId, [
    { repo: "public", path, content: JSON.stringify(parsed, null, 2) },
  ]);
}

/**
 * Load objectives for a scope (course-wide, or a chapter by slug) from the
 * PUBLIC repo. Returns a valid empty record when the file is absent.
 */
export async function loadObjectives(
  store: PackageStore,
  packageId: string,
  scope: Scope,
  slug?: string,
): Promise<Objectives> {
  requireSlug(scope, slug);
  const path = objectivesPath(scope, slug);
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === path);
  if (!file) {
    return { scope, objectives: [] };
  }
  return ObjectivesSchema.parse(JSON.parse(file.content));
}

/**
 * Save objectives: validate against the schema, derive its path from
 * `objectives.scope` + slug, validate the path against the layer contract,
 * then persist canonical JSON to the PUBLIC repo.
 */
export async function saveObjectives(
  store: PackageStore,
  packageId: string,
  objectives: Objectives,
  slug?: string,
): Promise<void> {
  const parsed = ObjectivesSchema.parse(objectives);
  requireSlug(parsed.scope, slug);
  const path = objectivesPath(parsed.scope, slug);
  assertPathAllowedInRepo(path, "public");
  await store.putFiles(packageId, [
    { repo: "public", path, content: JSON.stringify(parsed, null, 2) },
  ]);
}
