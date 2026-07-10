import { describe, expect, it } from "vitest";
import { PathLayerError } from "./layers";
import {
  CHAPTER_SCOPE_DIR,
  chapterScopedPath,
  scopeForPath,
  type CollectionScope,
} from "./scope";

const SLUGS = ["01-intro", "02-step", "03-step"] as const;

describe("CHAPTER_SCOPE_DIR", () => {
  it("is the reserved chapters folder name", () => {
    expect(CHAPTER_SCOPE_DIR).toBe("chapters");
  });
});

describe("scopeForPath", () => {
  it("classifies a file under a live chapter as chapter scope", () => {
    expect(scopeForPath("materials", "materials/chapters/03-step/fig.svg", SLUGS))
      .toEqual({ kind: "chapter", slug: "03-step" });
  });

  it("classifies an UNKNOWN slug as course, never a phantom chapter", () => {
    // The load-bearing adversarial case: a chapters/<slug>/ subtree whose slug
    // is not a live chapter must resolve to course scope.
    expect(
      scopeForPath("materials", "materials/chapters/ghost/fig.svg", SLUGS),
    ).toEqual({ kind: "course" });
  });

  it("classifies a file at the space root as course scope", () => {
    expect(scopeForPath("materials", "materials/fig.svg", SLUGS)).toEqual({
      kind: "course",
    });
  });

  it("classifies a named course-wide folder as course scope", () => {
    expect(
      scopeForPath("materials", "materials/structures/x.svg", SLUGS),
    ).toEqual({ kind: "course" });
    expect(
      scopeForPath("private", "private/answer-keys/final.md", SLUGS),
    ).toEqual({ kind: "course" });
  });

  it("classifies deep nesting under a live chapter as chapter scope", () => {
    expect(
      scopeForPath("materials", "materials/chapters/03-step/a/b/c.svg", SLUGS),
    ).toEqual({ kind: "chapter", slug: "03-step" });
  });

  it("treats a bare chapters folder with no slug as course scope", () => {
    expect(scopeForPath("materials", "materials/chapters/", SLUGS)).toEqual({
      kind: "course",
    });
    expect(scopeForPath("materials", "materials/chapters", SLUGS)).toEqual({
      kind: "course",
    });
  });

  it("does not throw for a path under a different space dir", () => {
    expect(
      scopeForPath("materials", "private/chapters/03-step/notes.md", SLUGS),
    ).toEqual({ kind: "course" });
    // even one that looks chapter-shaped under study-guide
    expect(
      scopeForPath("materials", "study-guide/chapters/03-step/x.md", SLUGS),
    ).toEqual({ kind: "course" });
  });

  it("normalizes backslash paths before classifying", () => {
    expect(
      scopeForPath("materials", "materials\\chapters\\03-step\\fig.svg", SLUGS),
    ).toEqual({ kind: "chapter", slug: "03-step" });
  });

  it("strips leading slashes like the sibling classifiers", () => {
    expect(
      scopeForPath("materials", "/materials/chapters/03-step/fig.svg", SLUGS),
    ).toEqual({ kind: "chapter", slug: "03-step" });
  });

  it("rejects .. traversal by throwing PathLayerError", () => {
    expect(() =>
      scopeForPath("materials", "materials/chapters/../../etc/passwd", SLUGS),
    ).toThrow(PathLayerError);
  });

  it("returns course when there are no chapters at all", () => {
    expect(
      scopeForPath("materials", "materials/chapters/03-step/fig.svg", []),
    ).toEqual({ kind: "course" });
  });
});

describe("chapterScopedPath", () => {
  it("builds <spaceDir>/chapters/<slug>/<rest>", () => {
    expect(chapterScopedPath("materials", "03-step", "fig.svg")).toBe(
      "materials/chapters/03-step/fig.svg",
    );
  });

  it("round-trips through scopeForPath as chapter scope", () => {
    const built = chapterScopedPath("materials", "03-step", "plots/a/b.svg");
    expect(built).toBe("materials/chapters/03-step/plots/a/b.svg");
    expect(scopeForPath("materials", built, SLUGS)).toEqual({
      kind: "chapter",
      slug: "03-step",
    });
  });

  it("normalizes backslashes and collapses duplicate slashes in rest", () => {
    expect(chapterScopedPath("materials", "03-step", "plots\\a//b.svg")).toBe(
      "materials/chapters/03-step/plots/a/b.svg",
    );
  });

  it("strips a trailing slash from the space dir", () => {
    expect(chapterScopedPath("materials/", "03-step", "fig.svg")).toBe(
      "materials/chapters/03-step/fig.svg",
    );
  });

  it("throws on empty spaceDir, slug, or rest", () => {
    expect(() => chapterScopedPath("", "03-step", "fig.svg")).toThrow(
      PathLayerError,
    );
    expect(() => chapterScopedPath("materials", "", "fig.svg")).toThrow(
      PathLayerError,
    );
    expect(() => chapterScopedPath("materials", "03-step", "")).toThrow(
      PathLayerError,
    );
  });

  it("throws on .. traversal in rest or slug", () => {
    expect(() =>
      chapterScopedPath("materials", "03-step", "../escape.svg"),
    ).toThrow(PathLayerError);
    expect(() =>
      chapterScopedPath("materials", "..", "fig.svg"),
    ).toThrow(PathLayerError);
  });

  it("throws on an absolute rest rather than silently rebasing it", () => {
    expect(() =>
      chapterScopedPath("materials", "03-step", "/etc/passwd"),
    ).toThrow(PathLayerError);
  });

  it("throws when the slug contains a path separator", () => {
    expect(() =>
      chapterScopedPath("materials", "03-step/extra", "fig.svg"),
    ).toThrow(PathLayerError);
  });
});

describe("CollectionScope type", () => {
  it("narrows on kind", () => {
    const scope: CollectionScope = { kind: "chapter", slug: "03-step" };
    const label = scope.kind === "chapter" ? scope.slug : "course";
    expect(label).toBe("03-step");
  });
});
