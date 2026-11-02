import { describe, expect, it, vi } from "vitest";
import { diffEdit, kindOfPath } from "./kit";
import { makeHooks, resolveCoursePath } from "./hooks";

describe("kindOfPath", () => {
  it("names the editor for a text file", () => {
    expect(kindOfPath("chapters/01/notes.md")).toBe("md");
    expect(kindOfPath("chapters/01/lecture.slides.md")).toBe("slides");
    expect(kindOfPath("handouts/lab.paged.md")).toBe("paged");
    expect(kindOfPath("figures/a.png")).toBeNull();
  });
});

describe("diffEdit", () => {
  it("is the smallest single replacement", () => {
    expect(diffEdit("abc", "abc")).toBeNull();
    expect(diffEdit("hello world", "hello brave world")).toEqual({ from: 6, to: 6, insert: "brave " });
    expect(diffEdit("a\nB\nc", "a\nb\nc")).toEqual({ from: 2, to: 3, insert: "b" });
    expect(diffEdit("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
    const before = "one two three", after = "one 2 three";
    const e = diffEdit(before, after)!;
    expect(before.slice(0, e.from) + e.insert + before.slice(e.to)).toBe(after);
  });
});

describe("resolveCoursePath", () => {
  it("resolves inside the course and refuses anything that leaves it", () => {
    expect(resolveCoursePath("chapters/01/notes.md", "parts/a.md")).toBe("chapters/01/parts/a.md");
    expect(resolveCoursePath("chapters/01/notes.md", "../02/b.md")).toBe("chapters/02/b.md");
    expect(resolveCoursePath("chapters/01/notes.md", "/figures/x.png")).toBe("figures/x.png");
    expect(resolveCoursePath("chapters/01/notes.md", "a.md#sec")).toBe("chapters/01/a.md");
    expect(resolveCoursePath("chapters/01/notes.md", "../../../etc/passwd")).toBeNull();
    expect(resolveCoursePath("chapters/01/notes.md", "https://example.org/a.md")).toBeNull();
    expect(resolveCoursePath("chapters/01/notes.md", "//evil.example/a.md")).toBeNull();
    expect(resolveCoursePath("chapters/01/notes.md", "javascript:alert(1)")).toBeNull();
  });
});

describe("makeHooks", () => {
  const ctx = () => ({
    packageId: "pkg-1",
    docPath: "chapters/01/notes.md",
    saveToDevice: vi.fn(async () => undefined),
    readCourseText: vi.fn(async (p: string) => (p === "chapters/01/parts/a.md" ? "included" : null)),
    assetUrls: new Map([["chapters/01/fig.png", "blob:x"]]),
    mintUid: vi.fn(async () => "doc-abcdefghij"),
  });
  it("saves to the device, reads course includes only, maps assets and links", async () => {
    const c = ctx();
    const h = makeHooks(c);
    await h.save!("text");
    expect(c.saveToDevice).toHaveBeenCalledWith("text");
    expect(await h.fetchInclude!("parts/a.md")).toBe("included");
    expect(await h.fetchInclude!("https://example.org/x.md")).toBeNull();
    expect(c.readCourseText).toHaveBeenCalledTimes(1);
    expect(h.resolveAsset!("fig.png")).toBe("blob:x");
    expect(h.resolveAsset!("missing.png")).toBe("missing.png");
    expect(h.resolveLink!("../02/b.md")).toBe("/workspace/pkg-1/doc/chapters/02/b.md");
    expect(h.resolveLink!("https://example.org")).toBe("https://example.org");
    expect(await h.mintUid!()).toBe("doc-abcdefghij");
    expect(h.uploadAsset).toBeUndefined();
  });
});
