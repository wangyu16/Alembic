import { describe, expect, it } from "vitest";
import { MemoryPackageStore } from "./memory-store";
import {
  chapterSlidesPath,
  loadSlidesDeck,
  prepareSlidesSave,
  saveSlidesDeck,
} from "./slides";

const PKG = "pkg-slides";
const DECK = "# Title\n\n<!-- slide -->\n\n## Second\n";

/**
 * `prepareSlidesSave` is the validation half of `saveSlidesDeck` (T15): the
 * two-repo invariant and the public reference guard, returning the exact bytes
 * and touching no store, so a published package commits before it projects
 * (docs/specs/storage-and-write-paths.md §3).
 */
describe("prepareSlidesSave", () => {
  it("returns the deck source verbatim at its public path", () => {
    const path = chapterSlidesPath("01-intro");
    expect(prepareSlidesSave({ path, source: DECK })).toEqual({
      repo: "public",
      path,
      content: DECK,
    });
  });

  it("refuses a deck that references a private file", () => {
    expect(() =>
      prepareSlidesSave({
        path: chapterSlidesPath("01-intro"),
        source: "![key](private-instructor/answer-keys/ch1.md)",
      }),
    ).toThrow();
  });

  it("refuses a path the public repo does not allow", () => {
    expect(() =>
      prepareSlidesSave({
        path: "private-instructor/notes/deck.md",
        source: DECK,
      }),
    ).toThrow();
  });

  it("writes nothing when it refuses", async () => {
    const store = new MemoryPackageStore();
    expect(() =>
      prepareSlidesSave({ path: "slides/x.md", source: "[k](private-instructor/k.md)" }),
    ).toThrow();
    expect(await store.listFiles(PKG)).toEqual([]);
  });
});

describe("saveSlidesDeck", () => {
  it("persists exactly the prepared bytes and reloads them", async () => {
    const store = new MemoryPackageStore();
    const path = chapterSlidesPath("01-intro");
    const prepared = prepareSlidesSave({ path, source: DECK });
    await saveSlidesDeck(store, PKG, { path, source: DECK });
    const written = (await store.listFiles(PKG)).find(
      (f) => f.repo === "public" && f.path === path,
    );
    expect(written).toEqual(prepared);
    expect((await loadSlidesDeck(store, PKG, path)).source).toBe(DECK);
  });

  it("returns an empty deck for a chapter with no deck yet", async () => {
    const store = new MemoryPackageStore();
    expect((await loadSlidesDeck(store, PKG, chapterSlidesPath("nope"))).source).toBe("");
  });
});
