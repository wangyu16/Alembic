import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNextPath, signInHref } from "./safe-next";

describe("safeNextPath — the post-sign-in return address (P6)", () => {
  it("keeps same-site paths, with query and fragment", () => {
    expect(safeNextPath("/p/pkg-abc?adapt=1#adapt")).toBe("/p/pkg-abc?adapt=1#adapt");
    expect(safeNextPath("/portal/element/doc-123")).toBe("/portal/element/doc-123");
    expect(safeNextPath("/portal?scope=elements&q=entropy")).toBe("/portal?scope=elements&q=entropy");
    expect(safeNextPath("/workspace")).toBe("/workspace");
  });

  it("defaults when missing or empty", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT);
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT);
    expect(safeNextPath("")).toBe(DEFAULT_NEXT);
  });

  // Adversarial: each of these would leave the site if concatenated onto the
  // origin (`${origin}${next}`) or resolved by a browser.
  it.each([
    "@evil.example",
    "@evil.example/p/x",
    "//evil.example",
    "//evil.example/p/x",
    "/\\evil.example",
    "\\\\evil.example",
    "/\\/evil.example",
    "https://evil.example",
    "http:evil.example",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,hi",
    ".evil.example",
    "evil.example",
    "p/relative",
    "/p/x@evil.example",
    "/%2f%2fevil.example",
    "/%5cevil.example",
    "/ /evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\u0000x",
    " /p/x",
    `/${"a".repeat(2000)}`,
  ])("refuses %j", (bad) => {
    expect(safeNextPath(bad)).toBe(DEFAULT_NEXT);
  });

  it("never yields anything that changes the origin when appended to it", () => {
    const origin = "https://alembic.orz.how";
    for (const raw of ["@evil.example", "//evil.example", "/\\evil.example", ".evil.example", ":443@evil"]) {
      const out = safeNextPath(raw);
      expect(new URL(`${origin}${out}`).origin).toBe(origin);
    }
  });

  it("normalises dot segments without leaving the site", () => {
    expect(safeNextPath("/../../etc")).toBe("/etc");
  });
});

describe("signInHref", () => {
  it("carries the page as next", () => {
    expect(signInHref("/p/pkg-a?adapt=1#adapt")).toBe(
      `/signin?next=${encodeURIComponent("/p/pkg-a?adapt=1#adapt")}`,
    );
  });
  it("drops an unsafe return address", () => {
    expect(signInHref("//evil.example")).toBe("/signin");
  });
});
