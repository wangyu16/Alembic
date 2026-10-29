import { describe, expect, it } from "vitest";
import { gitBlobSha, treeReader } from "./client";

const enc = (t: string) => new TextEncoder().encode(t);

function fake(files: Record<string, string>, opts: { substituted?: string; sizeEach?: number } = {}) {
  const calls = { list: 0, archive: 0, blob: 0 };
  const bytes = new Map(Object.entries(files).map(([p, t]) => [p, enc(t)]));
  const byBlob = new Map([...bytes].map(([, b]) => [gitBlobSha(b), b]));
  return {
    calls,
    client: {
      async listTreeEntries() {
        calls.list++;
        return { entries: [...bytes].map(([path, b]) => ({ path, mode: "100644", type: "blob", sha: gitBlobSha(b), size: opts.sizeEach ?? b.length })), truncated: false };
      },
      async getTreeArchive() {
        calls.archive++;
        const m = new Map(bytes);
        if (opts.substituted) m.set(opts.substituted, enc("$Format:%H$ substituted by git archive"));
        return m;
      },
      async getBlob(_c: unknown, sha: string) { calls.blob++; return byBlob.get(sha)!; },
    },
  };
}

describe("reading many files of one tree", () => {
  it("[RC.11] [RC.18] a course-size tree costs one listing and one archive for all its files; each file is checked against its blob id", async () => {
    const files = Object.fromEntries(Array.from({ length: 330 }, (_, k) => [`study-guide/ch${k}.md`, `# ${k}`]));
    const f = fake(files, { substituted: "study-guide/ch7.md" });
    const read = treeReader(f.client as never, { owner: "o", repo: "r" });
    const got = await Promise.all(Object.keys(files).map((p) => read("W", p)));
    expect(got.map((b) => new TextDecoder().decode(b!))).toEqual(Object.values(files)); // ch7 comes from its blob, not the archive's altered copy
    expect(await read("W", "missing.md")).toBeNull();
    expect(f.calls).toEqual({ list: 1, archive: 1, blob: 1 });
  });

  it("[RC.18] a tree bigger than the archive limit is read blob by blob (bounded memory), never as one archive", async () => {
    const f = fake({ "assets/a.pdf": "a", "assets/b.pdf": "b" }, { sizeEach: 60 * 1024 * 1024 });
    const read = treeReader(f.client as never, { owner: "o", repo: "r" });
    await read("W", "assets/a.pdf"); await read("W", "assets/b.pdf");
    expect(f.calls).toEqual({ list: 1, archive: 0, blob: 2 });
  });
});
