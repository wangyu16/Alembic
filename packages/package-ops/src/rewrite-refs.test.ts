import { describe, expect, it } from "vitest";
import { resolveRepoPath, rewriteRelativeRefs } from "./rewrite-refs";

/** A resolver over a fixed path→permalink table. */
function resolverFor(table: Record<string, string>) {
  return async (repoPath: string) => table[repoPath] ?? null;
}

describe("resolveRepoPath", () => {
  it("resolves a sibling path relative to the document's directory", () => {
    expect(resolveRepoPath("study-guide/ch1.md", "figures/p.png")).toBe(
      "study-guide/figures/p.png",
    );
  });
  it("resolves ../ against the document's directory", () => {
    expect(resolveRepoPath("study-guide/ch1.md", "../assets/p.png")).toBe("assets/p.png");
  });
  it("treats a leading slash as repo-root-relative", () => {
    expect(resolveRepoPath("study-guide/ch1.md", "/assets/p.png")).toBe("assets/p.png");
  });
  it("returns null when the path escapes the repo root", () => {
    expect(resolveRepoPath("ch1.md", "../../secret")).toBeNull();
  });
});

describe("rewriteRelativeRefs", () => {
  const table = {
    "assets/plot.png": "https://app.test/d/doc-plot01",
    "study-guide/figures/mol.svg": "https://app.test/d/doc-mol02",
  };

  it("rewrites a relative markdown image to its permalink", async () => {
    const out = await rewriteRelativeRefs(
      "See ![a plot](../assets/plot.png) here.",
      "study-guide/ch1.md",
      resolverFor(table),
    );
    expect(out).toBe("See ![a plot](https://app.test/d/doc-plot01) here.");
  });

  it("rewrites a sibling ref and an HTML <img src>", async () => {
    const md = `![mol](figures/mol.svg)\n<img src="figures/mol.svg" alt="m">`;
    const out = await rewriteRelativeRefs(md, "study-guide/ch1.md", resolverFor(table));
    expect(out).toBe(
      `![mol](https://app.test/d/doc-mol02)\n<img src="https://app.test/d/doc-mol02" alt="m">`,
    );
  });

  it("preserves a markdown title after the URL", async () => {
    const out = await rewriteRelativeRefs(
      `![a](../assets/plot.png "Figure 1")`,
      "study-guide/ch1.md",
      resolverFor(table),
    );
    expect(out).toBe(`![a](https://app.test/d/doc-plot01 "Figure 1")`);
  });

  it("leaves absolute, data, anchor and existing-permalink refs untouched", async () => {
    const md =
      `![x](https://cdn.example/x.png) ![y](data:image/png;base64,AA==) ` +
      `[a](#sec) ![z](/d/doc-existing)`;
    expect(await rewriteRelativeRefs(md, "study-guide/ch1.md", resolverFor(table))).toBe(md);
  });

  it("leaves a relative ref that resolves to no registered asset untouched", async () => {
    const md = "![missing](figures/none.png)";
    expect(await rewriteRelativeRefs(md, "study-guide/ch1.md", resolverFor(table))).toBe(md);
  });

  it("returns the content unchanged when there are no refs", async () => {
    const md = "# Title\n\nJust prose, no images.";
    expect(await rewriteRelativeRefs(md, "study-guide/ch1.md", resolverFor(table))).toBe(md);
  });
});
