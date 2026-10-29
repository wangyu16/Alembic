import { describe, expect, it } from "vitest";
import { assetContentType, assetUrl, assetUrlMap, signAsset, verifyAsset } from "./course-assets";

describe("course images in the editor", () => {
  it("[RC.9] every course image gets a members-only address; instructor-only files only for those allowed; other files none", () => {
    const paths = ["assets/fig 1.png", "study-guide/gases.md", "private/instructor/key.png", "assets/model.svg", "assets/data.csv"];
    const m = assetUrlMap("pkg-1", paths, false, "k");
    expect([...m.keys()]).toEqual(["assets/fig 1.png", "assets/model.svg"]);
    expect(m.get("assets/fig 1.png")).toMatch(/^\/workspace\/pkg-1\/asset\/assets\/fig%201\.png\?e=\d+&s=[\w-]+$/);
    expect([...assetUrlMap("pkg-1", paths, true, "k").keys()]).toContain("private/instructor/key.png");
    expect(assetContentType("x.SVG")).toBe("image/svg+xml");
    expect(assetContentType("x.html")).toBeNull();
    expect(assetUrl("pkg/../x", "a/b.png")).toBe("/workspace/pkg%2F..%2Fx/asset/a/b.png");
  });
});

describe("signed image addresses (the sandboxed preview sends no session)", () => {
  it("[RC.9] a signature opens exactly its course file until it expires; another file, another course, a forged or expired one doesn't", () => {
    const now = 1_800_000_000;
    const q = new URLSearchParams(signAsset("k", "pkg-1", "assets/a.png", now));
    const ok = (pkg: string, path: string, e = q.get("e"), s = q.get("s"), at = now + 60, key = "k") => verifyAsset(key, pkg, path, e, s, at);
    expect(ok("pkg-1", "assets/a.png")).toBe(true);
    expect(ok("pkg-1", "assets/b.png")).toBe(false);
    expect(ok("pkg-2", "assets/a.png")).toBe(false);
    expect(ok("pkg-1", "assets/a.png", q.get("e"), "x".repeat(43))).toBe(false);
    expect(ok("pkg-1", "assets/a.png", String(Number(q.get("e")) + 1))).toBe(false);
    expect(ok("pkg-1", "assets/a.png", q.get("e"), q.get("s"), now + 13 * 3600)).toBe(false);
    expect(ok("pkg-1", "assets/a.png", q.get("e"), q.get("s"), now + 60, "other-key")).toBe(false);
  });
});
