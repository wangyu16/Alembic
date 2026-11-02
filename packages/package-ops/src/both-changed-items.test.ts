import { describe, expect, it } from "vitest";
import { itemsForLandedChange } from "./both-changed-items";

describe("Needs-you items for a landed change", () => {
  it("[K1.12] each file where two changes met raises one item everyone in the course sees, pointing at the kept version", () => {
    const items = itemsForLandedChange({ rowId: "r1", actorId: "u1", commits: ["kept1", "top1"], deciders: ["o"], removed: new Map(),
      files: [{ path: "assets/a.png", outcome: "both-changed", reason: "both-changed-file" }, { path: "study-guide/x.md", outcome: "landed" }] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ dedupe: "both:r1:assets/a.png", addressed: [], payload: { keptCommit: "kept1", detail: expect.stringMatching(/replaced this file/) } });
  });
  it("[K1.16] typing that arrives for a removed chapter: its author is told the text is kept, and the owner and deputy are offered Restore (once per removal)", () => {
    const removed = new Map([["study-guide/gases.md", { slug: "gases", title: "Gases", fromCommit: "b".repeat(40) }]]);
    const items = itemsForLandedChange({ rowId: "r2", actorId: "co", commits: ["k"], deciders: ["owner", "dep"], removed,
      files: [{ path: "study-guide/gases.md", outcome: "both-changed", reason: "edit-vs-delete" }] });
    expect(items.map((i) => i.addressed)).toEqual([["co"], ["owner", "dep"]]);
    expect(items[1]!.payload.action).toEqual({ op: "restoreChapter", slug: "gases", fromCommit: "b".repeat(40) });
    expect(items[1]!.dedupe).toBe(`restore:gases:${"b".repeat(40)}`);
  });
});
