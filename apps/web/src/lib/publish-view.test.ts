import { describe, expect, it } from "vitest";
import { siteView } from "./publish-view";

describe("the website line on the Publish page", () => {
  it("[RC.3] a failed website build names each problem with its file (at most 20)", () => {
    const problems = Array.from({ length: 25 }, (_, k) => `slides/ch${k}.slides.md:7: deck-block: a <!-- deck … --> block`);
    const v = siteView({ status: "site-failed", results: { site: { error: "The website build found problems; the previous one stays up.", problems } } });
    expect(v).toMatchObject({ kind: "failed", error: "The website build found problems; the previous one stays up." });
    expect(v.kind === "failed" && v.problems).toEqual(problems.slice(0, 20));
  });
  it("shows only a GitHub Pages address as a link; building and none are told apart", () => {
    expect(siteView({ status: "site-built", results: { site: { url: "https://fishdream25.github.io/x/" } } })).toEqual({ kind: "live", url: "https://fishdream25.github.io/x/", note: null });
    expect(siteView({ status: "site-built", results: { site: { url: "javascript:alert(1)" } } })).toEqual({ kind: "updated" });
    expect(siteView({ status: "committed", results: {} })).toEqual({ kind: "building" });
    expect(siteView(undefined)).toEqual({ kind: "none" });
  });
});
