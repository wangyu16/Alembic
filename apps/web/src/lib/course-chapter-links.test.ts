import { describe, expect, it } from "vitest";
import { chapterLinks } from "./course-chapter-links";

const SITE = "https://yuwang-cmu.github.io/demo-plate-tectonics-oer/";
const titles = ["Plate Tectonics", "Tectonic Hazards"];
const chapters = [
  { slug: "plate-tectonics", title: "Plate Tectonics" },
  { slug: "tectonic-hazards", title: "Tectonic Hazards" },
];

describe("course page: chapters link to the student site", () => {
  it("links each chapter to its page", () => {
    expect(chapterLinks(SITE, titles, chapters)).toEqual([
      `${SITE}chapters/plate-tectonics.md.html`,
      `${SITE}chapters/tectonic-hazards.md.html`,
    ]);
    expect(chapterLinks(SITE.slice(0, -1), titles, chapters)[0]).toBe(`${SITE}chapters/plate-tectonics.md.html`);
  });

  it.each([
    ["no site", "", chapters],
    ["not https", "http://x.github.io/c/", chapters],
    ["javascript", "javascript:alert(1)", chapters],
    ["count differs", SITE, chapters.slice(0, 1)],
    ["titles differ", SITE, [chapters[1], chapters[0]]],
    ["bad slug", SITE, [{ slug: "../evil", title: "Plate Tectonics" }, chapters[1]]],
    ["no chapters", SITE, null],
  ])("no links when %s", (_why, site, ch) => {
    expect(chapterLinks(site as string, titles, ch)).toEqual([null, null]);
  });
});
