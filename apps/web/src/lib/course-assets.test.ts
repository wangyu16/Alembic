import { describe, expect, it } from "vitest";
import { assetContentType, assetUrl, assetUrlMap } from "./course-assets";

describe("course images in the editor", () => {
  it("[RC.9] every course image gets a members-only address; instructor-only files only for those allowed; other files none", () => {
    const paths = ["assets/fig 1.png", "study-guide/gases.md", "private/instructor/key.png", "assets/model.svg", "assets/data.csv"];
    const m = assetUrlMap("pkg-1", paths, false);
    expect([...m.keys()]).toEqual(["assets/fig 1.png", "assets/model.svg"]);
    expect(m.get("assets/fig 1.png")).toBe("/workspace/pkg-1/asset/assets/fig%201.png");
    expect([...assetUrlMap("pkg-1", paths, true).keys()]).toContain("private/instructor/key.png");
    expect(assetContentType("x.SVG")).toBe("image/svg+xml");
    expect(assetContentType("x.html")).toBeNull();
    expect(assetUrl("pkg/../x", "a/b.png")).toBe("/workspace/pkg%2F..%2Fx/asset/a/b.png");
  });
});
