import { describe, expect, it } from "vitest";
import { MemoryDraftStore, draftKey } from "./store";

describe("MemoryDraftStore", () => {
  it("keeps drafts per course and path, lists by course, deletes", async () => {
    const s = new MemoryDraftStore();
    await s.put({ key: draftKey("pkg-1", "chapters/a.md"), text: "a", baseVersion: null, savedAt: 1, private: false });
    await s.put({ key: draftKey("pkg-1", "instructor/k.md"), text: "k", baseVersion: null, savedAt: 2, private: true });
    await s.put({ key: draftKey("pkg-10", "chapters/a.md"), text: "z", baseVersion: null, savedAt: 3, private: false });
    expect((await s.list("pkg-1:")).map((d) => d.text).sort()).toEqual(["a", "k"]);
    await s.delete(draftKey("pkg-1", "instructor/k.md"));
    expect(await s.get(draftKey("pkg-1", "instructor/k.md"))).toBeNull();
  });
});

import { resumeFrom } from "./store";

describe("reopening a document (RC.17)", () => {
  const draft = (o: Partial<{ text: string; baseVersion: string | null; synced: boolean }>) => ({ key: "k", text: "mine", baseVersion: "v0", savedAt: 1, private: false, ...o });
  it("[RC.17] text on this device that never reached the course wins on reopening and is sent again with its own base, even after the course moved on; text the course already has never comes back", () => {
    expect(resumeFrom(draft({ baseVersion: "v0" }), { text: "course v1", version: "v1" })).toEqual({ text: "mine", pending: { text: "mine", baseVersion: "v0" } });
    expect(resumeFrom(draft({ baseVersion: "v0", synced: false }), { text: "course v0", version: "v0" })).toEqual({ text: "mine", pending: { text: "mine", baseVersion: "v0" } });
    expect(resumeFrom(draft({ synced: true }), { text: "course v2", version: "v2" })).toEqual({ text: "course v2", pending: null });
    expect(resumeFrom(draft({ text: "same" }), { text: "same", version: "v1" })).toEqual({ text: "same", pending: null });
    expect(resumeFrom(undefined, { text: "course", version: "v1" })).toEqual({ text: "course", pending: null });
  });
});
