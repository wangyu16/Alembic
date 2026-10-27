/** G3 round-2 adversary probes (Publish job). Each `it` fails today. */
import { describe, expect, it } from "vitest";
import { copyChecks } from "./copy-check";
import { FakePublic, FakeStore, manifestJson, working } from "./publish-fakes";
import { runPublish, type UnitCheck } from "./publish-job";

const M = manifestJson([{ slug: "atoms" }, { slug: "gases" }]);
const W: Record<string, string> = {
  "concepts/atoms.md": "atoms plan", "assessment-support/atoms.md": "atoms assess", "study-guide/atoms.md": "# Atoms",
  "concepts/gases.md": "gases plan", "assessment-support/gases.md": "gases assess", "study-guide/gases.md": "# Gases",
  "README.md": "readme", "LICENSE": "CC-BY-4.0", "alembic.json": M,
};
const noChecks: UnitCheck[] = [];
const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`;
const input = (over: Partial<Parameters<typeof runPublish>[0]> = {}) => ({
  runId: id(1), packageId: "pkg-1", by: "owner", role: "owner" as const, choices: { publishAnyway: [] as string[], approveAndPublish: [] as string[] }, ...over,
});
const approve = (st: FakeStore, files: Record<string, string>, slugs: string[]) => {
  for (const s of slugs) for (const p of [`concepts/${s}.md`, `assessment-support/${s}.md`]) st.approveText(p, files[p]!);
};

describe("G3r2: course unit link check (L2) keeps the whole course unit", () => {
  it("a course map linking a not-yet-approved chapter still publishes README, LICENSE and the course map", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const files = { ...W, "concepts/course.md": "# Map\n- [Atoms](../study-guide/atoms.md)\n- [Gases](../study-guide/gases.md)\n" };
    approve(st, files, ["atoms"]); // gases is still being written
    const out = await runPublish(input(), working(files), pub, st, noChecks);
    expect(out.status).toBe("committed");
    expect(pub.file("LICENSE")).toBe("CC-BY-4.0"); // FAILS: course unit kept (link to gases), no override possible
  });
  it("a chapter linking back to the course map is not kept because a Draft chapter is listed on the map", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const files = { ...W, "study-guide/atoms.md": "# Atoms\n[Back](../concepts/course.md)", "concepts/course.md": "[Gases](../study-guide/gases.md)",
      "alembic.json": manifestJson([{ slug: "atoms" }, { slug: "gases", mode: "draft" }]) };
    approve(st, files, ["atoms", "gases"]);
    const out = await runPublish(input({ choices: { publishAnyway: [], approveAndPublish: [] } }), working(files), pub, st, noChecks);
    expect(out.status === "committed" && out.published).toEqual(["atoms"]); // FAILS: cascade, nothing publishes
  });
  it("a removed chapter the course map at W still links to stays public (publisher §2), no dangling map", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const map = "[Atoms](../study-guide/atoms.md) [Gases](../study-guide/gases.md)";
    const W1 = { ...W, "concepts/course.md": map };
    approve(st, W1, ["atoms", "gases"]);
    await runPublish(input(), working(W1), pub, st, noChecks);
    const W2 = { ...W1, "concepts/course.md": map + "\nupdated", "alembic.json": manifestJson([{ slug: "atoms" }]) };
    await runPublish(input({ runId: id(2) }), working(W2), pub, st, noChecks);
    const mapPublic = pub.file("concepts/course.md") ?? "";
    expect(mapPublic.includes("gases.md") && pub.file("study-guide/gases.md") === undefined).toBe(false); // FAILS: old map kept, gases deleted
  });
});

describe("G3r2: deleted assets (H3)", () => {
  it("a deleted asset linked by a chapter kept for two runs in a row stays (kept records have version null)", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const W1 = { ...W, "assets/fig.svg": "<svg/>", "study-guide/atoms.md": "# Atoms ![f](../assets/fig.svg)" };
    approve(st, W1, ["atoms", "gases"]);
    await runPublish(input(), working(W1), pub, st, noChecks);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms v2", "concepts/atoms.md": "plan v2" }; // atoms kept (plan not approved), fig deleted
    await runPublish(input({ runId: id(2) }), working(W2), pub, st, noChecks);
    expect(pub.file("assets/fig.svg")).toBe("<svg/>");
    const W3 = { ...W2, "study-guide/gases.md": "# Gases v3" };
    await runPublish(input({ runId: id(3) }), working(W3), pub, st, noChecks);
    expect(pub.file("study-guide/atoms.md")).toContain("assets/fig.svg");
    expect(pub.file("assets/fig.svg")).toBe("<svg/>"); // FAILS: dropped, the kept chapter's image breaks
  });
  it("a deleted asset is not kept because of a PASSING chapter's old published text", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const W1 = { ...W, "assets/stolen.png": "PNG", "study-guide/atoms.md": "# Atoms ![f](../assets/stolen.png)" };
    approve(st, W1, ["atoms", "gases"]);
    await runPublish(input(), working(W1), pub, st, noChecks);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms (figure removed for rights)" }; // atoms passes, asset deleted
    await runPublish(input({ runId: id(2) }), working(W2), pub, st, noChecks);
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms (figure removed for rights)");
    expect(pub.file("assets/stolen.png")).toBeUndefined(); // FAILS: still public after this Publish
  });
});

describe("G3r2: authorisation (P.8)", () => {
  it("a deputy can't complete a first Publish that crashed after creating the repo", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approve(st, W, ["atoms", "gases"]);
    await pub.create(); // the owner's first Publish died right after create()
    const out = await runPublish(input({ role: "deputy", by: "deputy" }), working(W), pub, st, noChecks);
    expect(out.status).toBe("stopped"); // FAILS: deputy makes the first real Publish
  });
});

describe("G3r2: binary by extension", () => {
  it("a binary file with an unlisted extension (.docx) doesn't stop every Publish (adapter can't read it as text)", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approve(st, W, ["atoms", "gases"]);
    // Fixed by classifying by content: the adapter reports a NUL-containing file as binary, not unreadable.
    const files = { ...W, "assets/handout.docx": "PK\u0003\u0004\u0000\u0000" };
    const out = await runPublish(input(), working(files), pub, st, noChecks);
    expect(out.status).toBe("committed"); // FAILS: "Couldn't read assets/handout.docx to check it" forever
  });
  it("answer-key text in a file named .PNG is still checked", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const key = "The equilibrium constant equals the product concentration squared divided by the reactant concentration at twenty five degrees";
    const files = { ...W, "private/instructor/key.md": key, "study-guide/chapters/atoms/answers.PNG": key };
    approve(st, files, ["atoms", "gases"]);
    const out = await runPublish(input(), working(files), pub, st, copyChecks([{ path: "private/instructor/key.md", text: key }], []));
    expect(out.status === "committed" && out.published).not.toContain("atoms"); // FAILS: published unchecked
  });
});

describe("G3r2: drift", () => {
  it("a file added on GitHub under a never-published chapter slug is not silently discarded", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approve(st, W, ["atoms", "gases"]);
    await runPublish(input(), working(W), pub, st, noChecks);
    await pub.push("study-guide/chapters/kinetics/contributed.md", "a contributor's new chapter");
    await runPublish(input({ runId: id(2) }), working(W), pub, st, noChecks);
    await runPublish(input({ runId: id(3) }), working(W), pub, st, noChecks);
    const kept = st.drift.flat().includes("study-guide/chapters/kinetics/contributed.md") || pub.file("study-guide/chapters/kinetics/contributed.md") !== undefined;
    expect(kept).toBe(true); // FAILS: acknowledged as "brought in", then deleted by the next Publish
  });
});
