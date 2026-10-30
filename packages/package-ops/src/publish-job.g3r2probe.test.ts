/**
 * G3 round-2 adversary probes (Publish job), kept as regression tests. The
 * course-unit link-check probes were retired with the link check (family
 * SITE-TYPE-CONTRACT §7: the person decides what is published).
 */
import { describe, expect, it } from "vitest";
import { cleanSvg } from "@alembic/package-contract";
import { FakePublic, FakeStore, manifestJson, working } from "./publish-fakes";
import { runPublish } from "./publish-job";

type Status = Record<string, "completed" | "withdrawn">;
const manifest = (chs: Array<{ slug: string }>, status: Status = {}) => JSON.stringify({ ...JSON.parse(manifestJson(chs)), status });
const pagesOf = (slug: string) => [`concepts/${slug}.md`, `assessment-support/${slug}.md`, `study-guide/${slug}.md`];
const ALL: Status = Object.fromEntries([...pagesOf("atoms"), ...pagesOf("gases"), "README.md"].map((p) => [p, "completed" as const]));
const allBut = (...draft: string[]): Status => Object.fromEntries(Object.entries(ALL).filter(([p]) => !draft.includes(p)));
const CH = [{ slug: "atoms" }, { slug: "gases" }];

const W: Record<string, string> = {
  "concepts/atoms.md": "atoms plan", "assessment-support/atoms.md": "atoms assess", "study-guide/atoms.md": "# Atoms",
  "concepts/gases.md": "gases plan", "assessment-support/gases.md": "gases assess", "study-guide/gases.md": "# Gases",
  "README.md": "readme", "LICENSE": "CC-BY-4.0", "alembic.json": manifest(CH, ALL),
};
const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`;
const input = (over: Partial<Parameters<typeof runPublish>[0]> = {}) => ({
  runId: id(1), packageId: "pkg-1", by: "owner", role: "owner" as const, ...over,
});

describe("G3r2: deleted assets (H3)", () => {
  it("a deleted asset linked by a draft page kept for two runs in a row stays (kept records have version null)", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const W1 = { ...W, "assets/fig.svg": "<svg/>", "study-guide/atoms.md": "# Atoms ![f](../assets/fig.svg)" };
    await runPublish(input(), working(W1), pub, st);
    const draft = manifest(CH, allBut("study-guide/atoms.md"));
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms v2", "alembic.json": draft }; // atoms page back to draft, fig deleted
    await runPublish(input({ runId: id(2) }), working(W2), pub, st);
    expect(pub.file("assets/fig.svg")).toBe(cleanSvg("<svg/>"));
    const W3 = { ...W2, "study-guide/gases.md": "# Gases v3" };
    await runPublish(input({ runId: id(3) }), working(W3), pub, st);
    expect(pub.file("study-guide/gases.md")).toBe("# Gases v3");
    expect(pub.file("study-guide/atoms.md")).toContain("assets/fig.svg");
    expect(pub.file("assets/fig.svg")).toBe(cleanSvg("<svg/>"));
  });
  it("a deleted asset is not kept because of a COMPLETED page's old published text", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const W1 = { ...W, "assets/stolen.png": "PNG", "study-guide/atoms.md": "# Atoms ![f](../assets/stolen.png)" };
    await runPublish(input(), working(W1), pub, st);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms (figure removed for rights)" }; // atoms completed, asset deleted
    await runPublish(input({ runId: id(2) }), working(W2), pub, st);
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms (figure removed for rights)");
    expect(pub.file("assets/stolen.png")).toBeUndefined();
  });
});

describe("G3r2: authorisation (P.8)", () => {
  it("a deputy can't complete a first Publish that crashed after creating the repo", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await pub.create(); // the owner's first Publish died right after create()
    const out = await runPublish(input({ role: "deputy", by: "deputy" }), working(W), pub, st);
    expect(out.status).toBe("stopped");
  });
});

describe("G3r2: binary by extension", () => {
  it("a binary file with an unlisted extension (.docx) doesn't stop every Publish (adapter can't read it as text)", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    // Fixed by classifying by content: the adapter reports a NUL-containing file as binary, not unreadable.
    const files = { ...W, "assets/handout.docx": "PK\u0003\u0004\u0000\u0000" };
    const out = await runPublish(input(), working(files), pub, st);
    expect(out.status).toBe("committed");
  });
});

describe("G3r2: drift", () => {
  it("a file added on GitHub under a never-published chapter slug is brought in, not silently discarded", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await runPublish(input(), working(W), pub, st);
    await pub.push("study-guide/chapters/kinetics/contributed.md", "a contributor's new chapter");
    const out = await runPublish(input({ runId: id(2) }), working(W), pub, st);
    expect(st.drift.flat()).toContain("study-guide/chapters/kinetics/contributed.md");
    expect(out).toMatchObject({ status: "committed", broughtIn: ["study-guide/chapters/kinetics/contributed.md"] });
  });
});
