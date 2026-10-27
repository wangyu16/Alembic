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
