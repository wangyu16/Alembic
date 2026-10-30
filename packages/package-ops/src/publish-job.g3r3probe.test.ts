/**
 * G3 round-3 adversary probes (Publish job), kept as regression tests. The
 * encoding probes for the answer-key check were retired with the unit checks
 * (family SITE-TYPE-CONTRACT §7).
 */
import { describe, expect, it } from "vitest";
import { FakePublic, FakeStore, manifestJson } from "./publish-fakes";
import { classifyBytes, runPublish, type WorkingSide } from "./publish-job";

const pages = ["concepts/atoms.md", "assessment-support/atoms.md", "study-guide/atoms.md", "concepts/gases.md", "assessment-support/gases.md", "study-guide/gases.md", "README.md"];
const M = JSON.stringify({ ...JSON.parse(manifestJson([{ slug: "atoms" }, { slug: "gases" }])), status: Object.fromEntries(pages.map((p) => [p, "completed"])) });
const W: Record<string, string> = {
  "concepts/atoms.md": "atoms plan", "assessment-support/atoms.md": "atoms assess", "study-guide/atoms.md": "# Atoms",
  "concepts/gases.md": "gases plan", "assessment-support/gases.md": "gases assess", "study-guide/gases.md": "# Gases",
  "README.md": "readme", "alembic.json": M,
};
const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`;
const input = (over: Partial<Parameters<typeof runPublish>[0]> = {}) => ({
  runId: id(1), packageId: "pkg-1", by: "owner", role: "owner" as const, ...over,
});

/** A working side whose files are raw bytes, classified like a real adapter would (classifyBytes). */
function workingBytes(files: Record<string, string | Uint8Array>): WorkingSide {
  const bytes = (v: string | Uint8Array) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
  return {
    async head() { return "W1"; },
    async listTree() { return { entries: Object.keys(files).map((p) => ({ path: p, mode: "100644", blobSha: `wb-${p}` })), truncated: false }; },
    async readFile(_s, p) { return p in files ? classifyBytes(bytes(files[p]!)) : null; },
  };
}

describe("G3r3: stopped runs marked (L6) — every stop after the pending record is marked", () => {
  it("a retry that finds the public tree truncated marks the pending run stopped", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const stopped: string[] = [];
    st.markStopped = async (rid) => { stopped.push(rid); };
    await runPublish(input(), workingBytes(W), pub, st);
    // Second run: the first commit attempt sees the head move (acknowledged head unchanged), the retry's listTree is truncated.
    pub.moveOnce = true;
    const realList = pub.listTree.bind(pub);
    let calls = 0;
    pub.listTree = async (sha: string) => (++calls >= 2 ? { entries: [], truncated: true } : realList(sha));
    const out = await runPublish(input({ runId: id(2) }), workingBytes({ ...W, "study-guide/atoms.md": "# Atoms v2" }), pub, st);
    expect(out.status).toBe("stopped");
    expect(stopped).toContain(id(2));
  });
});
