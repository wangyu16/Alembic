import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classifyOutside, outsideCommits, parsePush, undoKey, verifyGithubWebhook } from "./door-c";

const S = (c: string) => c.repeat(40);

describe("verifyGithubWebhook", () => {
  it("accepts GitHub's signature and nothing else", () => {
    const body = '{"a":1}';
    const sig = `sha256=${createHmac("sha256", "sec").update(body).digest("hex")}`;
    expect(verifyGithubWebhook(body, sig, "sec")).toBe(true);
    expect(verifyGithubWebhook(body + " ", sig, "sec")).toBe(false);
    expect(verifyGithubWebhook(body, sig, "other")).toBe(false);
    expect(verifyGithubWebhook(body, sig.replace("sha256=", "sha1="), "sec")).toBe(false);
    expect(verifyGithubWebhook(body, null, "sec")).toBe(false);
    expect(verifyGithubWebhook(body, sig, "")).toBe(false);
  });
});

describe("parsePush", () => {
  const ok = { installation: { id: 7 }, repository: { id: 9, full_name: "o/r-private" }, ref: "refs/heads/main", before: S("a"), after: S("b"), forced: true, pusher: { name: "eve" }, commits: [{ id: S("c") }, { id: "nope" }] };
  it("keeps ids only, drops malformed commit ids", () => {
    expect(parsePush(ok)).toEqual({ installationId: 7, repoId: 9, repoFullName: "o/r-private", ref: "refs/heads/main", before: S("a"), after: S("b"), forced: true, pusherLogin: "eve", commitIds: [S("c")] });
  });
  it("refuses a malformed event", () => {
    expect(parsePush({ ...ok, after: "x" })).toBeNull();
    expect(parsePush({ ...ok, installation: {} })).toBeNull();
    expect(parsePush(null)).toBeNull();
  });
});

describe("outsideCommits", () => {
  it("trusts recorded SHAs, not trailers", () => {
    expect(outsideCommits([S("1"), S("2")], new Set([S("1")]))).toEqual([S("2")]);
  });
});

describe("classifyOutside", () => {
  it("undoes links, submodules, Alembic's files, sources, Coursewerk records and unclassifiable paths; informs on .github; keeps edits", () => {
    const v = classifyOutside([
      { path: "study-guide/ch1.md", mode: "100644" },
      { path: "study-guide/old.md", mode: null },
      { path: "assets/run.sh", mode: "100755" },
      { path: "study-guide/link.md", mode: "120000" },
      { path: "vendor", mode: "160000" },
      { path: ".alembic/state.json", mode: "100644" },
      { path: ".gitignore", mode: "100644" },
      { path: "private/sources/src_x.json", mode: "100644" },
      { path: "private/coursewerk/run.json", mode: "100644" },
      { path: "random/file.txt", mode: "100644" },
      { path: "../escape.md", mode: "100644" },
      { path: ".github/workflows/x.yml", mode: "100644" },
    ]);
    expect(v.edits).toEqual(["study-guide/ch1.md", "study-guide/old.md", "assets/run.sh"]);
    expect(v.inform).toEqual([".github/workflows/x.yml"]);
    expect(v.undo.map((u) => u.path)).toEqual([
      "study-guide/link.md", "vendor", ".alembic/state.json", ".gitignore", "private/sources/src_x.json",
      "private/coursewerk/run.json", "random/file.txt", "../escape.md",
    ]);
    expect(undoKey(S("f"))).toBe(`undo:${S("f")}`);
  });
});

describe("Door C and the type package's records", () => {
  it("[K1.25] pushes to either records folder are undone (only Coursewerk's tools write them, through Alembic)", () => {
    const v = classifyOutside([{ path: "provenance/coursewerk/ATTRIBUTION.md", mode: "100644" }, { path: "private/coursewerk/LOG.jsonl", mode: "100644" }]);
    expect(v.undo.map((u) => u.path).sort()).toEqual(["private/coursewerk/LOG.jsonl", "provenance/coursewerk/ATTRIBUTION.md"]);
  });
});

