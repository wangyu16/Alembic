/** G3 round-3 adversary probes (Publish job). Each `it` fails today. */
import { describe, expect, it } from "vitest";
import { copyChecks } from "./copy-check";
import { FakePublic, FakeStore, manifestJson } from "./publish-fakes";
import { classifyBytes, runPublish, type UnitCheck, type WorkingSide } from "./publish-job";

const M = manifestJson([{ slug: "atoms" }, { slug: "gases" }]);
const W: Record<string, string> = {
  "concepts/atoms.md": "atoms plan", "assessment-support/atoms.md": "atoms assess", "study-guide/atoms.md": "# Atoms",
  "concepts/gases.md": "gases plan", "assessment-support/gases.md": "gases assess", "study-guide/gases.md": "# Gases",
  "README.md": "readme", "alembic.json": M,
};
const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`;
const input = (over: Partial<Parameters<typeof runPublish>[0]> = {}) => ({
  runId: id(1), packageId: "pkg-1", by: "owner", role: "owner" as const, choices: { publishAnyway: [] as string[], approveAndPublish: [] as string[] }, ...over,
});
const approveAll = (st: FakeStore, files: Record<string, string>) => {
  for (const [p, t] of Object.entries(files)) if (p.startsWith("concepts/") || p.startsWith("assessment-support/")) st.approveText(p, t);
};

/** A working side whose files are raw bytes, classified like a real adapter would (classifyBytes). */
function workingBytes(files: Record<string, string | Uint8Array>): WorkingSide {
  const bytes = (v: string | Uint8Array) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
  return {
    async head() { return "W1"; },
    async listTree() { return { entries: Object.keys(files).map((p) => ({ path: p, mode: "100644", blobSha: `wb-${p}` })), truncated: false }; },
    async readFile(_s, p) { return p in files ? classifyBytes(bytes(files[p]!)) : null; },
  };
}
const utf16le = (s: string) => {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff; out[1] = 0xfe; // BOM
  for (let i = 0; i < s.length; i++) { out[2 + 2 * i] = s.charCodeAt(i) & 0xff; out[3 + 2 * i] = s.charCodeAt(i) >> 8; }
  return out;
};
const cp1252 = (s: string) => Uint8Array.from([...s].map((c) => (c === "’" ? 0x92 : c.charCodeAt(0))));

const KEY = "The equilibrium constant equals the product concentration squared divided by the reactant concentration at twenty five degrees";

describe("G3r3: classifyBytes treats real-world text encodings as binary, so the answer-key check is skipped", () => {
  for (const [name, enc] of [
    ["UTF-16LE with BOM (Windows Notepad 'Unicode')", utf16le(`# Practice\n\n${KEY}\n`)],
    ["Windows-1252 with one curly apostrophe", cp1252(`# Practice\n\nIt’s simple: ${KEY}\n`)],
  ] as const) {
    it(`an answer key copied into practice/atoms.md saved as ${name} is not published`, async () => {
      const pub = new FakePublic(); const st = new FakeStore();
      const files = { ...W, "private/instructor/key.md": KEY, "practice/atoms.md": enc };
      approveAll(st, W);
      const checks: UnitCheck[] = copyChecks([{ path: "private/instructor/key.md", text: KEY }], []);
      const out = await runPublish(input(), workingBytes(files), pub, st, checks);
      // FAILS: classified { binary }, the check skips text === null, the chapter passes and the file is published by blob.
      expect(out.status === "committed" && out.published).not.toContain("atoms");
      expect(pub.file("practice/atoms.md")).toBeUndefined();
    });
  }
});

describe("G3r3: stopped runs marked (L6) — not every stop after the pending record is marked", () => {
  it("a retry that finds the public tree truncated marks the pending run stopped", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    const stopped: string[] = [];
    (st as unknown as { markStopped: (id: string) => Promise<void> }).markStopped = async (rid) => { stopped.push(rid); };
    await runPublish(input(), workingBytes(W), pub, st, []);
    // Second run: the first commit attempt sees the head move (acknowledged head unchanged), the retry's listTree is truncated.
    pub.moveOnce = true;
    const realList = pub.listTree.bind(pub);
    let calls = 0;
    pub.listTree = async (sha: string) => (++calls >= 2 ? { entries: [], truncated: true } : realList(sha));
    const out = await runPublish(input({ runId: id(2) }), workingBytes({ ...W, "study-guide/atoms.md": "# Atoms v2" }), pub, st, []);
    expect(out.status).toBe("stopped");
    expect(stopped).toContain(id(2)); // FAILS: left 'pending' forever
  });
});
