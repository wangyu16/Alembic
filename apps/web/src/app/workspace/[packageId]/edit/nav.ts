import type { OperationCategory } from "@alembic/ai-operations";

/**
 * Workspace navigation model (subtask P2.3; docs/specs/workspace-collections.md).
 *
 * Two kinds of destination, which the old flat `StudioCategory` conflated:
 *
 *  - **Chapter documents** — one document belonging to one chapter. They split
 *    by role: the SPINE (concept map, assessment guide) is concise, private,
 *    plain-text — the skeleton of the course; the PUBLISHED documents (study
 *    guide, slides, practice) are the comprehensive artifacts rendered on the
 *    student site.
 *  - **Collections** — Assets, Current, Private. Course-wide *libraries*, not
 *    per-chapter documents, so they hang off the course rather than a chapter
 *    and carry their own within-collection scope (whole course / one chapter).
 *
 * Pure: URL parsing/building and lookup tables only. No React, no IO.
 */

export const CHAPTER_DOCS = [
  "concept-map",
  "assessment-guide",
  "content",
  "slides",
  "practice",
] as const;
export type ChapterDoc = (typeof CHAPTER_DOCS)[number];

export const COLLECTIONS = ["assets", "current", "private"] as const;
export type Collection = (typeof COLLECTIONS)[number];

/** The course spine: not published, plain text, hand-maintained. */
export const SPINE_DOCS: readonly ChapterDoc[] = ["concept-map", "assessment-guide"];
/** Rendered on the student site. */
export const PUBLISHED_DOCS: readonly ChapterDoc[] = ["content", "slides", "practice"];

export const DOC_LABELS: Record<ChapterDoc, string> = {
  "concept-map": "Concept map",
  "assessment-guide": "Assessment guide",
  content: "Study guide",
  slides: "Slides",
  practice: "Practice questions",
};

export const COLLECTION_LABELS: Record<Collection, string> = {
  assets: "Assets",
  current: "Current (this term)",
  private: "Private",
};

/**
 * Document → AI operation category. Explicit rather than a cast, because the
 * hosted editors advertise their ops over `orz-host-ai` at mount: if a `doc` id
 * ever stopped mapping to a real `OperationCategory`, the handshake would still
 * succeed and the in-file AI would silently offer nothing. `Record` makes a
 * missing entry a compile error.
 */
export const DOC_OPERATION_CATEGORY: Record<ChapterDoc, OperationCategory> = {
  "concept-map": "concept-map",
  "assessment-guide": "assessment-guide",
  content: "content",
  slides: "slides",
  practice: "practice",
};

export const COLLECTION_OPERATION_CATEGORY: Record<Collection, OperationCategory> = {
  assets: "assets",
  current: "current",
  private: "private",
};

/** Scope value meaning "the whole course" (vs a chapter slug). */
export const COURSE_SCOPE = "course";

/** Opened when a chapter is selected without naming a document. */
export const DEFAULT_DOC: ChapterDoc = "content";

export type WorkspaceView =
  | { kind: "course" }
  | { kind: "doc"; doc: ChapterDoc }
  | { kind: "collection"; collection: Collection; scope: string };

/** Raw search params this route understands, new scheme + legacy `cat`. */
export interface WorkspaceParams {
  chapter?: string;
  doc?: string;
  view?: string;
  collection?: string;
  scope?: string;
  /** Legacy (pre-2026-07-09) single param. Mapped forward; still emitted by no
   *  one, but old bookmarks and external links carry it. */
  cat?: string;
}

function asDoc(v: string | undefined): ChapterDoc | undefined {
  return CHAPTER_DOCS.find((d) => d === v);
}
function asCollection(v: string | undefined): Collection | undefined {
  return COLLECTIONS.find((c) => c === v);
}

/**
 * Resolve the current view from search params. New params win; `cat=` is
 * mapped forward for old links. Unknown values fall back to the chapter's
 * default document rather than erroring — a bad URL should never 404 an editor.
 */
export function parseWorkspaceView(p: WorkspaceParams): WorkspaceView {
  if (p.view === "course") return { kind: "course" };

  const collection = asCollection(p.collection);
  if (collection) {
    return { kind: "collection", collection, scope: p.scope || COURSE_SCOPE };
  }

  const doc = asDoc(p.doc);
  if (doc) return { kind: "doc", doc };

  // Legacy `cat=` — one param that could mean any of the three kinds.
  if (p.cat === "course") return { kind: "course" };
  const legacyCollection = asCollection(p.cat);
  if (legacyCollection) {
    return { kind: "collection", collection: legacyCollection, scope: COURSE_SCOPE };
  }
  const legacyDoc = asDoc(p.cat);
  if (legacyDoc) return { kind: "doc", doc: legacyDoc };

  return { kind: "doc", doc: DEFAULT_DOC };
}

/**
 * Build a workspace URL for a view. `chapterSlug` is carried on document views
 * (and preserved across collection/course views so returning to a chapter lands
 * where you left it).
 */
export function buildWorkspaceHref(
  packageId: string,
  view: WorkspaceView,
  chapterSlug: string | null,
): string {
  const qs = new URLSearchParams();
  if (chapterSlug) qs.set("chapter", chapterSlug);
  switch (view.kind) {
    case "course":
      qs.set("view", "course");
      break;
    case "doc":
      qs.set("doc", view.doc);
      break;
    case "collection":
      qs.set("collection", view.collection);
      qs.set("scope", view.scope);
      break;
  }
  return `/workspace/${packageId}/edit?${qs.toString()}`;
}

/** True when the view is a chapter document in the non-published spine. */
export function isSpineDoc(doc: ChapterDoc): boolean {
  return SPINE_DOCS.includes(doc);
}
