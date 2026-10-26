import { describe, expect, it } from "vitest";
import {
  elementAlt,
  elementDescription,
  isImageKind,
  previewOf,
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
    expect(kindLabel("xyz")).toBe("XYZ file");
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

  it("[BC 2026-10-26 P7] kind ids are never shown raw", () => {
    expect(kindLabel("ketcher")).toBe("Chemical structure");
    expect(kindLabel("KETCHER")).toBe("Chemical structure");
    expect(kindLabel("plot")).toBe("Plot");
    expect(kindLabel("mp4")).toBe("Video");
    expect(kindLabel("docx")).toBe("Word document");
    for (const k of ["ketcher", "plot", "md", "slides", "paged", "png", "jpg", "svg", "mp3", "csv", "html"]) {
      expect(kindLabel(k)).not.toBe(k.toUpperCase());
    }
  });

  it("[BC 2026-10-26 P7] previews: SVG carriers are images; media get players", () => {
    expect(previewOf("ketcher")).toBe("image");
    expect(previewOf("plot")).toBe("image");
    expect(previewOf("png")).toBe("image");
    expect(previewOf("mp3")).toBe("audio");
    expect(previewOf("mp4")).toBe("video");
    expect(previewOf("md")).toBeNull();
  });

  it("[BC 2026-10-26 P7] a description that only repeats the title is not shown again", () => {
    expect(elementDescription({ title: "test sharing", description: "Test sharing." })).toBeNull();
    expect(elementDescription({ title: "Benzene", description: "Kekulé structure of benzene" })).toBe(
      "Kekulé structure of benzene",
    );
    expect(elementDescription({ title: "x", description: null })).toBeNull();
    expect(elementAlt({ title: "Benzene", kind: "ketcher", description: null, alt_text: null })).toBe(
      "Chemical structure: Benzene",
    );
    expect(elementAlt({ title: "B", kind: "ketcher", description: "d", alt_text: "Ring of six carbons" })).toBe(
      "Ring of six carbons",
    );
  });
});
