/** Workspace v3 A3: a course's token scope comes from the recorded repositories only. */
import { describe, expect, it } from "vitest";
import { courseRepoScope } from "./github-scope";

describe("courseRepoScope", () => {
  it("scopes to the working repo, plus the public repo once it exists", () => {
    expect(courseRepoScope({ private_repo: { owner: "yu", name: "chem-private" }, public_repo: null })).toEqual({ owner: "yu", names: ["chem-private"] });
    expect(courseRepoScope({ private_repo: { owner: "yu", name: "chem-private" }, public_repo: { owner: "yu", name: "chem-oer" } }))
      .toEqual({ owner: "yu", names: ["chem-private", "chem-oer"] });
  });
  it("refuses a course without a working repo, or with repos in two accounts", () => {
    expect(courseRepoScope({ private_repo: null, public_repo: { owner: "yu", name: "x" } })).toBeNull();
    expect(courseRepoScope({ private_repo: { owner: "yu", name: "a" }, public_repo: { owner: "evil", name: "b" } })).toBeNull();
  });
});
