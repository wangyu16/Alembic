import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/github", () => ({ clientForCourse: async () => null }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => null }));
vi.mock("@/lib/db", () => ({ directDb: () => null }));
import { textVersion, versionsAt } from "./course-v3";

describe("plan versions on the Publish page", () => {
  it("[RC.8] a 19-chapter page makes one tree listing per render; each file is read once ever (cached by its blob id)", async () => {
    const files: Record<string, string> = {};
    for (let k = 0; k < 19; k++) { files[`concepts/ch${k}.md`] = `map ${k}`; files[`assessment-support/ch${k}.md`] = `guide ${k}`; }
    const blobs = new Map(Object.entries(files).map(([p, t]) => [`blob-${p}`, t]));
    const calls = { tree: 0, blob: 0 };
    const client = {
      async listTreeEntries() { calls.tree++; return { entries: Object.keys(files).map((p) => ({ path: p, mode: "100644", type: "blob", sha: `blob-${p}` })), truncated: false }; },
      async getBlob(_c: unknown, sha: string) { calls.blob++; return new TextEncoder().encode(blobs.get(sha)!); },
    };
    const paths = [...Object.keys(files), "concepts/missing.md"];
    const first = await versionsAt(client as never, { owner: "o", repo: "r" }, "H", paths);
    expect(first.get("concepts/ch3.md")).toBe(textVersion("map 3"));
    expect(first.get("concepts/missing.md")).toBeNull();
    expect(calls).toEqual({ tree: 1, blob: 38 });
    await versionsAt(client as never, { owner: "o", repo: "r" }, "H", paths);
    expect(calls).toEqual({ tree: 2, blob: 38 }); // the second render reads no file
  });
});
