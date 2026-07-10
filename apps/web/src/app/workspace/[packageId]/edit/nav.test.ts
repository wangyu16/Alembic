import { describe, expect, it } from "vitest";
import {
  CHAPTER_DOCS,
  COLLECTIONS,
  COURSE_SCOPE,
  DOC_LABELS,
  DOC_OPERATION_CATEGORY,
  buildWorkspaceHref,
  isSpineDoc,
  parseWorkspaceView,
  PUBLISHED_DOCS,
  SPINE_DOCS,
  type WorkspaceParams,
  type WorkspaceView,
} from "./nav";

/** Parse a href produced by `buildWorkspaceHref` back into search params. */
function paramsOf(href: string): WorkspaceParams {
  const qs = new URLSearchParams(href.slice(href.indexOf("?") + 1));
  return Object.fromEntries(qs.entries()) as WorkspaceParams;
}

const PKG = "pkg_1";
const SLUG = "ch-01";

describe("parseWorkspaceView", () => {
  it("defaults to the chapter landing list when no view param is present", () => {
    // The spine must stay one click from view, not hidden behind the study
    // guide. A bare `?chapter=` opens the list, not a document.
    expect(parseWorkspaceView({})).toEqual({ kind: "chapter" });
    expect(parseWorkspaceView({ chapter: SLUG })).toEqual({ kind: "chapter" });
  });

  it("reads the course view", () => {
    expect(parseWorkspaceView({ view: "course" })).toEqual({ kind: "course" });
  });

  it("reads each chapter document", () => {
    for (const doc of CHAPTER_DOCS) {
      expect(parseWorkspaceView({ chapter: SLUG, doc })).toEqual({ kind: "doc", doc });
    }
  });

  it("reads a collection, defaulting scope to the whole course", () => {
    expect(parseWorkspaceView({ collection: "assets" })).toEqual({
      kind: "collection",
      collection: "assets",
      scope: COURSE_SCOPE,
    });
    expect(parseWorkspaceView({ collection: "private", scope: SLUG })).toEqual({
      kind: "collection",
      collection: "private",
      scope: SLUG,
    });
  });

  // ── The preserve-don't-regress contract (P2.6) ─────────────────────────────
  // Old bookmarks/links carry a single `cat=` param that could mean any of the
  // three kinds. They must land exactly where they always did — in particular
  // `cat=content` opens the STUDY GUIDE, never the new landing list.
  describe("legacy `cat=` links keep working", () => {
    it("maps a legacy document to that document, not the landing list", () => {
      for (const doc of CHAPTER_DOCS) {
        expect(parseWorkspaceView({ chapter: SLUG, cat: doc })).toEqual({ kind: "doc", doc });
      }
    });

    it("maps the legacy course value", () => {
      expect(parseWorkspaceView({ cat: "course" })).toEqual({ kind: "course" });
    });

    it("maps a legacy collection at course scope", () => {
      for (const collection of COLLECTIONS) {
        expect(parseWorkspaceView({ cat: collection })).toEqual({
          kind: "collection",
          collection,
          scope: COURSE_SCOPE,
        });
      }
    });

    it("lets new params win over a legacy one", () => {
      expect(parseWorkspaceView({ doc: "slides", cat: "course" })).toEqual({
        kind: "doc",
        doc: "slides",
      });
      expect(parseWorkspaceView({ view: "course", cat: "content" })).toEqual({ kind: "course" });
      expect(parseWorkspaceView({ collection: "assets", cat: "content" })).toEqual({
        kind: "collection",
        collection: "assets",
        scope: COURSE_SCOPE,
      });
    });
  });

  it("falls back to the landing list on unknown values rather than erroring", () => {
    // A bad URL should never 404 the workspace.
    expect(parseWorkspaceView({ doc: "bogus" })).toEqual({ kind: "chapter" });
    expect(parseWorkspaceView({ cat: "bogus" })).toEqual({ kind: "chapter" });
    expect(parseWorkspaceView({ collection: "bogus" })).toEqual({ kind: "chapter" });
    expect(parseWorkspaceView({ view: "bogus" })).toEqual({ kind: "chapter" });
  });
});

describe("buildWorkspaceHref", () => {
  it("emits only `?chapter=` for the landing view", () => {
    expect(buildWorkspaceHref(PKG, { kind: "chapter" }, SLUG)).toBe(
      `/workspace/${PKG}/edit?chapter=${SLUG}`,
    );
  });

  it("carries the chapter slug across course and collection views", () => {
    // Returning to a chapter should land where you left it.
    expect(buildWorkspaceHref(PKG, { kind: "course" }, SLUG)).toContain(`chapter=${SLUG}`);
    expect(
      buildWorkspaceHref(PKG, { kind: "collection", collection: "assets", scope: COURSE_SCOPE }, SLUG),
    ).toContain(`chapter=${SLUG}`);
  });

  it("omits the chapter param when there is no active chapter", () => {
    expect(buildWorkspaceHref(PKG, { kind: "course" }, null)).toBe(
      `/workspace/${PKG}/edit?view=course`,
    );
  });
});

describe("href round-trip", () => {
  // The strongest guard: every view this app can build must parse back to
  // itself. A switcher link that round-trips wrong silently opens the wrong
  // document — and every one of these links is a real anchor, so a wrong href
  // is a wrong navigation, not a no-op.
  const views: WorkspaceView[] = [
    { kind: "course" },
    { kind: "chapter" },
    ...CHAPTER_DOCS.map((doc): WorkspaceView => ({ kind: "doc", doc })),
    ...COLLECTIONS.map((collection): WorkspaceView => ({
      kind: "collection",
      collection,
      scope: COURSE_SCOPE,
    })),
    ...COLLECTIONS.map((collection): WorkspaceView => ({
      kind: "collection",
      collection,
      scope: SLUG,
    })),
  ];

  for (const view of views) {
    it(`round-trips ${JSON.stringify(view)}`, () => {
      expect(parseWorkspaceView(paramsOf(buildWorkspaceHref(PKG, view, SLUG)))).toEqual(view);
    });
  }

  it("preserves the chapter slug through the round-trip", () => {
    for (const view of views) {
      expect(paramsOf(buildWorkspaceHref(PKG, view, SLUG)).chapter).toBe(SLUG);
    }
  });
});

describe("document roles", () => {
  it("partitions every chapter document into exactly one role group", () => {
    // Guards the landing list and switcher, which render these two groups: a
    // new doc added to CHAPTER_DOCS but to neither group would silently vanish
    // from both the list and the menu.
    const union = [...SPINE_DOCS, ...PUBLISHED_DOCS];
    expect([...union].sort()).toEqual([...CHAPTER_DOCS].sort());
    expect(new Set(union).size).toBe(CHAPTER_DOCS.length);
  });

  it("marks exactly the spine documents as unpublished", () => {
    for (const doc of SPINE_DOCS) expect(isSpineDoc(doc)).toBe(true);
    for (const doc of PUBLISHED_DOCS) expect(isSpineDoc(doc)).toBe(false);
  });

  it("gives every document a label and an AI operation category", () => {
    for (const doc of CHAPTER_DOCS) {
      expect(DOC_LABELS[doc]).toBeTruthy();
      expect(DOC_OPERATION_CATEGORY[doc]).toBeTruthy();
    }
  });
});
