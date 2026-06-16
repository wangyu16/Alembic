/**
 * Assessment ops (Phase 4, M24): read/write for question templates, assessment
 * blueprints, generated question items, and instructor-only answer keys, plus
 * the embargo release-time check.
 *
 * Public/private boundary is HARD (CLAUDE.md rule 1):
 *   - Templates, blueprints, and items are public-safe → `repo:"public"`,
 *     validated with `assertPathAllowedInRepo(path, "public")` before write.
 *   - Answer keys are instructor-only → `repo:"private"`, validated with
 *     `assertAnswerKeyPrivate` (which fails closed: a key that would also be
 *     allowed public is rejected) before write. Answer keys are NEVER written
 *     with `repo:"public"`.
 *
 * Schema is owned by `@alembic/package-contract`; this module is pure I/O over
 * a `PackageStore` (no AI, no GitHub). Validation happens here so a malformed
 * record is rejected and never written. Mirrors `planning.ts`.
 */

import {
  assertPathAllowedInRepo,
  assertAnswerKeyPrivate,
  questionTemplatePath,
  blueprintPath,
  questionItemPath,
  answerKeyPath,
  QuestionTemplateSchema,
  AssessmentBlueprintSchema,
  QuestionItemSchema,
  AnswerKeySchema,
  type QuestionTemplate,
  type AssessmentBlueprint,
  type QuestionItem,
  type AnswerKey,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";

// --- question templates (PUBLIC: assessment-support) ------------------------

/** Save a question template: validate, assert public placement, persist JSON. */
export async function saveQuestionTemplate(
  store: PackageStore,
  packageId: string,
  t: QuestionTemplate,
): Promise<void> {
  const parsed = QuestionTemplateSchema.parse(t);
  const path = questionTemplatePath(parsed.id);
  assertPathAllowedInRepo(path, "public");
  await store.putFiles(packageId, [
    { repo: "public", path, content: JSON.stringify(parsed, null, 2) },
  ]);
}

/** Load a question template by id from the PUBLIC repo, or null if absent. */
export async function loadQuestionTemplate(
  store: PackageStore,
  packageId: string,
  id: string,
): Promise<QuestionTemplate | null> {
  const path = questionTemplatePath(id);
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === path);
  if (!file) return null;
  return QuestionTemplateSchema.parse(JSON.parse(file.content));
}

/** List all question templates under `assessment-support/templates/`. */
export async function listQuestionTemplates(
  store: PackageStore,
  packageId: string,
): Promise<QuestionTemplate[]> {
  const files = await store.listFiles(packageId);
  return files
    .filter(
      (f) =>
        f.repo === "public" &&
        f.path.startsWith("assessment-support/templates/"),
    )
    .map((f) => QuestionTemplateSchema.parse(JSON.parse(f.content)));
}

// --- assessment blueprints (PUBLIC: assessment-support) ---------------------

/** Save an assessment blueprint: validate, assert public placement, persist. */
export async function saveBlueprint(
  store: PackageStore,
  packageId: string,
  b: AssessmentBlueprint,
): Promise<void> {
  const parsed = AssessmentBlueprintSchema.parse(b);
  const path = blueprintPath(parsed.id);
  assertPathAllowedInRepo(path, "public");
  await store.putFiles(packageId, [
    { repo: "public", path, content: JSON.stringify(parsed, null, 2) },
  ]);
}

/** Load a blueprint by id from the PUBLIC repo, or null if absent. */
export async function loadBlueprint(
  store: PackageStore,
  packageId: string,
  id: string,
): Promise<AssessmentBlueprint | null> {
  const path = blueprintPath(id);
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === path);
  if (!file) return null;
  return AssessmentBlueprintSchema.parse(JSON.parse(file.content));
}

/** List all blueprints under `assessment-support/blueprints/`. */
export async function listBlueprints(
  store: PackageStore,
  packageId: string,
): Promise<AssessmentBlueprint[]> {
  const files = await store.listFiles(packageId);
  return files
    .filter(
      (f) =>
        f.repo === "public" &&
        f.path.startsWith("assessment-support/blueprints/"),
    )
    .map((f) => AssessmentBlueprintSchema.parse(JSON.parse(f.content)));
}

// --- question items (PUBLIC stem: assessment-support) -----------------------

/** Save a question item (public stem, NO answer): validate, assert, persist. */
export async function saveQuestionItem(
  store: PackageStore,
  packageId: string,
  item: QuestionItem,
): Promise<void> {
  const parsed = QuestionItemSchema.parse(item);
  const path = questionItemPath(parsed.id);
  assertPathAllowedInRepo(path, "public");
  await store.putFiles(packageId, [
    { repo: "public", path, content: JSON.stringify(parsed, null, 2) },
  ]);
}

/** Load a question item by id from the PUBLIC repo, or null if absent. */
export async function loadQuestionItem(
  store: PackageStore,
  packageId: string,
  id: string,
): Promise<QuestionItem | null> {
  const path = questionItemPath(id);
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === path);
  if (!file) return null;
  return QuestionItemSchema.parse(JSON.parse(file.content));
}

/** List all question items under `assessment-support/items/`. */
export async function listQuestionItems(
  store: PackageStore,
  packageId: string,
): Promise<QuestionItem[]> {
  const files = await store.listFiles(packageId);
  return files
    .filter(
      (f) =>
        f.repo === "public" && f.path.startsWith("assessment-support/items/"),
    )
    .map((f) => QuestionItemSchema.parse(JSON.parse(f.content)));
}

// --- answer keys (PRIVATE: private-instructor) ------------------------------

/**
 * Save an answer key: validate, then `assertAnswerKeyPrivate` (fails closed —
 * the path must be rejected for the public repo) BEFORE any write, then persist
 * to the PRIVATE repo. Answer keys are NEVER written with `repo:"public"`.
 */
export async function saveAnswerKey(
  store: PackageStore,
  packageId: string,
  key: AnswerKey,
): Promise<void> {
  const parsed = AnswerKeySchema.parse(key);
  const path = answerKeyPath(parsed.itemId);
  assertAnswerKeyPrivate(path);
  await store.putFiles(packageId, [
    { repo: "private", path, content: JSON.stringify(parsed, null, 2) },
  ]);
}

/** Load an answer key for an item from the PRIVATE repo, or null if absent. */
export async function loadAnswerKey(
  store: PackageStore,
  packageId: string,
  itemId: string,
): Promise<AnswerKey | null> {
  const path = answerKeyPath(itemId);
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "private" && f.path === path);
  if (!file) return null;
  return AnswerKeySchema.parse(JSON.parse(file.content));
}

// --- embargo release-time check (pure) --------------------------------------

/**
 * Whether a blueprint is released at `now`: true if it has no embargo or no
 * `releaseAt`, or if `releaseAt <= now`. The owner early-lift is a separate
 * Tier-3 web action; this is only the time check.
 */
export function isReleased(blueprint: AssessmentBlueprint, now: Date): boolean {
  const releaseAt = blueprint.embargo?.releaseAt;
  if (!releaseAt) return true;
  return new Date(releaseAt).getTime() <= now.getTime();
}
