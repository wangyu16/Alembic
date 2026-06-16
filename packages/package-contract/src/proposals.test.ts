import { describe, expect, it } from "vitest";
import {
  PROPOSED_CHANGE_SET_VERSION,
  ProposedChangeSetSchema,
  validateProposedChangeSet,
  type ProposedChangeSet,
} from "./proposals";

const BLK_A = "blk-aaaaaaaa";
const BLK_B = "blk-bbbbbbbb";
const BLK_C = "blk-cccccccc";

function baseSet(operations: ProposedChangeSet["operations"]): ProposedChangeSet {
  return {
    version: PROPOSED_CHANGE_SET_VERSION,
    task: "Make terminology consistent across chapters",
    summary: "Aligned 'molarity' usage and fixed an out-of-order section.",
    findings: [],
    operations,
  };
}

const ctx = { blockIdsByChapter: { intro: [BLK_A, BLK_B], kinetics: [BLK_C] } };

describe("ProposedChangeSetSchema", () => {
  it("parses a well-formed set with mixed operations", () => {
    const parsed = ProposedChangeSetSchema.parse(
      baseSet([
        { op: "update-block", chapterSlug: "intro", blockId: BLK_A, body: "x", rationale: "clarify" },
        { op: "create-block", chapterSlug: "intro", afterBlockId: BLK_B, title: "Recap", body: "y", rationale: "bridge" },
        { op: "reorder-blocks", chapterSlug: "intro", orderedBlockIds: [BLK_B, BLK_A], rationale: "sequence" },
      ]),
    );
    expect(parsed.operations).toHaveLength(3);
  });

  it("rejects a malformed block ID in an update (block-ID integrity at the schema)", () => {
    const r = ProposedChangeSetSchema.safeParse(
      baseSet([{ op: "update-block", chapterSlug: "intro", blockId: "nope", body: "x", rationale: "r" } as never]),
    );
    expect(r.success).toBe(false);
  });

  it("requires a rationale on every operation", () => {
    const r = ProposedChangeSetSchema.safeParse(
      baseSet([{ op: "update-block", chapterSlug: "intro", blockId: BLK_A, body: "x", rationale: "" } as never]),
    );
    expect(r.success).toBe(false);
  });
});

describe("validateProposedChangeSet", () => {
  it("passes operations that reference existing blocks", () => {
    const r = validateProposedChangeSet(
      baseSet([
        { op: "update-block", chapterSlug: "intro", blockId: BLK_A, body: "x", rationale: "r" },
        { op: "create-block", chapterSlug: "intro", afterBlockId: BLK_B, title: "T", body: "b", rationale: "r" },
        { op: "create-block", chapterSlug: "kinetics", afterBlockId: null, title: "T", body: "b", rationale: "r" },
      ]),
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("flags an update to a non-existent block (never invents IDs)", () => {
    const r = validateProposedChangeSet(
      baseSet([{ op: "update-block", chapterSlug: "intro", blockId: BLK_C, body: "x", rationale: "r" }]),
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain("missing block");
  });

  it("flags an unknown chapter", () => {
    const r = validateProposedChangeSet(
      baseSet([{ op: "update-block", chapterSlug: "ghost", blockId: BLK_A, body: "x", rationale: "r" }]),
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain("unknown chapter");
  });

  it("flags an update that changes nothing", () => {
    const r = validateProposedChangeSet(
      baseSet([{ op: "update-block", chapterSlug: "intro", blockId: BLK_A, rationale: "r" }]),
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain("changes nothing");
  });

  it("requires a reorder to be a permutation: rejects omissions and unknowns and dupes", () => {
    const omits = validateProposedChangeSet(
      baseSet([{ op: "reorder-blocks", chapterSlug: "intro", orderedBlockIds: [BLK_A], rationale: "r" }]),
      ctx,
    );
    expect(omits.ok).toBe(false);
    expect(omits.issues.some((m) => m.includes("omits"))).toBe(true);

    const unknown = validateProposedChangeSet(
      baseSet([{ op: "reorder-blocks", chapterSlug: "intro", orderedBlockIds: [BLK_A, BLK_B, BLK_C], rationale: "r" }]),
      ctx,
    );
    expect(unknown.issues.some((m) => m.includes("unknown block"))).toBe(true);

    const dupe = validateProposedChangeSet(
      baseSet([{ op: "reorder-blocks", chapterSlug: "intro", orderedBlockIds: [BLK_A, BLK_A], rationale: "r" }]),
      ctx,
    );
    expect(dupe.issues.some((m) => m.includes("more than once"))).toBe(true);
  });

  it("flags a create-block inserting after a missing block", () => {
    const r = validateProposedChangeSet(
      baseSet([{ op: "create-block", chapterSlug: "intro", afterBlockId: BLK_C, title: "T", body: "b", rationale: "r" }]),
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain("inserts after missing block");
  });
});
