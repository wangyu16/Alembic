import { describe, expect, it } from "vitest";
import { publicRepoName } from "./publish-loop";
import { pagesUrl, siteInput } from "./site-build-loop";

describe("publish and site helpers", () => {
  it("the public repo is named after the working repo, without -private", () => {
    expect(publicRepoName("gen-chem-a1b2c3-private")).toBe("gen-chem-a1b2c3");
    expect(publicRepoName("odd-name")).toBe("odd-name-public");
  });

  it("hidden files and folders are never site input", () => {
    for (const p of [".github/workflows/x.yml", ".alembic/build/build-site.mjs", ".gitignore", "study-guide/.draft.md"]) expect(siteInput(p)).toBe(false);
    for (const p of ["study-guide/atoms.md", "README.md", "assets/fig.png", "alembic.json"]) expect(siteInput(p)).toBe(true);
  });

  it("a project Pages site lives under the repo name, owner lower-cased", () => {
    expect(pagesUrl({ owner: "FishDream25", repo: "chem" })).toBe("https://fishdream25.github.io/chem/");
  });
});
