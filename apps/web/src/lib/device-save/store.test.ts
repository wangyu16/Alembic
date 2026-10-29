import { describe, expect, it } from "vitest";
import { MemoryDraftStore, arrivalToCheck, draftKey } from "./store";

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
    expect(resumeFrom(draft({ baseVersion: "v0", synced: false }), { text: "course v1", version: "v1" })).toEqual({ text: "mine", pending: { text: "mine", baseVersion: "v0" } });
    // A record from before the flag: resumed only if the course hasn't moved (it may hold text the course already has).
    expect(resumeFrom(draft({ baseVersion: "v0" }), { text: "course v1", version: "v1" })).toEqual({ text: "course v1", pending: null });
    expect(resumeFrom(draft({ baseVersion: "v1" }), { text: "course v1", version: "v1" })).toEqual({ text: "mine", pending: { text: "mine", baseVersion: "v1" } });
    expect(resumeFrom(draft({ baseVersion: "v0", synced: false }), { text: "course v0", version: "v0" })).toEqual({ text: "mine", pending: { text: "mine", baseVersion: "v0" } });
    expect(resumeFrom(draft({ synced: true }), { text: "course v2", version: "v2" })).toEqual({ text: "course v2", pending: null });
    expect(resumeFrom(draft({ text: "same" }), { text: "same", version: "v1" })).toEqual({ text: "same", pending: null });
    expect(resumeFrom(undefined, { text: "course", version: "v1" })).toEqual({ text: "course", pending: null });
    // Sent while the tab was closing (the reply never came back): the course has it, so it isn't resent over newer work.
    expect(resumeFrom(draft({ baseVersion: "v0", synced: false }), { text: "course v2", version: "v2" }, true)).toEqual({ text: "course v2", pending: null });
  });
});

describe("asking whether a kept text arrived (audit r5 MEDIUM-1, LOW-2)", () => {
  const rec = (o: Partial<import("./store").DeviceDraft>) => ({ key: "k", text: "A", baseVersion: "v1", savedAt: 0, private: false, ...o });
  it("[RC.17] resume asks only about the sync that carried exactly the kept text; a revert never sent is resent, never taken for an arrival", () => {
    // The device holds "A" again after "AX" was synced: the course once held "A", but this text was never sent.
    expect(arrivalToCheck(rec({ synced: false }), "AX")).toBeNull();
    expect(arrivalToCheck(rec({ synced: false, sentId: "s-1" }), "AX")).toBe("s-1");
    expect(arrivalToCheck(rec({ synced: true, sentId: "s-1" }), "AX")).toBeNull();
    expect(arrivalToCheck(rec({ synced: false, sentId: "s-1" }), "A")).toBeNull();
  });
  it("[RC.17] update reads and writes one record together: an older text never overwrites a newer one", async () => {
    const s = new MemoryDraftStore();
    await s.put(rec({ text: "new", synced: false }));
    await s.update("k", (cur) => (cur && cur.text === "old" ? { ...cur, synced: true } : undefined));
    expect(await s.get("k")).toMatchObject({ text: "new", synced: false });
    await s.update("k", (cur) => (cur && cur.text === "new" ? null : undefined));
    expect(await s.get("k")).toBeNull();
  });
});
