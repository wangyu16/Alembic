import { describe, expect, it } from "vitest";
import {
  isImageKind,
  kindLabel,
  licenseLabelOf,
  plural,
  publisherOf,
  spaceLabel,
} from "./discovery-labels";

describe("Discover labels (educator words, no Git words)", () => {
  it("[P5.A.4.d] names spaces, kinds and licences", () => {
    expect(spaceLabel("practice")).toBe("Practice questions");
    expect(spaceLabel("some-new-space")).toBe("Some new space");
    expect(kindLabel("md")).toBe("Text");
    expect(kindLabel("xyz")).toBe("XYZ");
    expect(licenseLabelOf("CC-BY-SA-4.0")).toBe("CC BY-SA 4.0");
    expect(licenseLabelOf("Custom")).toBe("Custom");
  });

  it("[P5.A.4.d] never says repository, branch, commit or GitHub", () => {
    const words = ["study-guide", "slides", "practice", "concepts", "assessment-support", "assets", "metadata", "provenance"]
      .map(spaceLabel)
      .concat(["md", "slides", "paged", "svg", "png", "pdf", "html"].map(kindLabel))
      .join(" ")
      .toLowerCase();
    for (const w of ["repo", "branch", "commit", "github", "git "]) expect(words).not.toContain(w);
  });

  it("small helpers", () => {
    expect(isImageKind("SVG")).toBe(true);
    expect(isImageKind("md")).toBe(false);
    expect(plural(1, "chapter")).toBe("1 chapter");
    expect(plural(3, "chapter")).toBe("3 chapters");
    expect(publisherOf("https://github.com/wangyu16/gen-chem-oer")).toBe("wangyu16");
    expect(publisherOf("https://example.com/x")).toBe("");
  });
});
