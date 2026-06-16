import { describe, it, expect } from "vitest";
import {
  ProposedChangeSetSchema,
  PROPOSED_CHANGE_SET_VERSION,
} from "@alembic/package-contract";
import type { AIProvider, GenerateResult } from "./provider";
import {
  createProviderCoherenceHarness,
  createStubCoherenceHarness,
  type CoherenceRunInput,
} from "./coherence-agent";

const SAMPLE: CoherenceRunInput = {
  task: "make terminology consistent",
  courseTitle: "Intro Chemistry",
  chapters: [
    {
      slug: "ch-1",
      title: "Atoms",
      blocks: [
        { id: "blk-aaaa1111", title: "The Atom", body: "Atoms are tiny." },
        { id: "blk-bbbb2222", title: "Electrons", body: "Electrons orbit." },
      ],
    },
    {
      slug: "ch-2",
      title: "Bonds",
      blocks: [{ id: "blk-cccc3333", title: "Ionic Bonds", body: "Ions attract." }],
    },
  ],
};

/** A fake provider whose generateText returns a fixed string. */
function fakeProvider(text: string): AIProvider {
  return {
    name: "fake",
    async generateText(): Promise<GenerateResult> {
      return { text, model: "fake-model" };
    },
  };
}

describe("createStubCoherenceHarness", () => {
  it("returns a schema-valid ProposedChangeSet for a sample course", async () => {
    const harness = createStubCoherenceHarness();
    const set = await harness.run(SAMPLE);

    expect(() => ProposedChangeSetSchema.parse(set)).not.toThrow();
    expect(set.version).toBe(PROPOSED_CHANGE_SET_VERSION);
    expect(set.task).toBe(SAMPLE.task);
    expect(set.operations).toHaveLength(1);
    expect(set.operations[0]).toMatchObject({
      op: "update-block",
      chapterSlug: "ch-1",
      blockId: "blk-aaaa1111",
    });
  });

  it("handles a course with no editable content", async () => {
    const set = await createStubCoherenceHarness().run({
      task: "review",
      chapters: [{ slug: "empty", title: "Empty", blocks: [] }],
    });
    expect(set.operations).toHaveLength(0);
    expect(set.findings).toHaveLength(0);
    expect(() => ProposedChangeSetSchema.parse(set)).not.toThrow();
  });
});

describe("createProviderCoherenceHarness", () => {
  it("parses fenced JSON, stamps the version, and strips id markers from bodies", async () => {
    const canned = JSON.stringify({
      task: "make terminology consistent",
      summary: "Unify the term 'electron'.",
      findings: [
        {
          kind: "terminology",
          summary: "'electron' vs 'e-' used inconsistently.",
          locations: [{ chapterSlug: "ch-1", blockId: "blk-bbbb2222" }],
        },
      ],
      operations: [
        {
          op: "update-block",
          chapterSlug: "ch-1",
          blockId: "blk-bbbb2222",
          body: "Electrons orbit the nucleus.{{attrs[#blk-bbbb2222]}}",
          rationale: "Use 'electron' consistently.",
        },
      ],
    });
    const harness = createProviderCoherenceHarness(
      fakeProvider("```json\n" + canned + "\n```"),
    );

    const set = await harness.run(SAMPLE);

    expect(() => ProposedChangeSetSchema.parse(set)).not.toThrow();
    expect(set.version).toBe(PROPOSED_CHANGE_SET_VERSION);
    const op = set.operations[0];
    expect(op?.op).toBe("update-block");
    if (op?.op === "update-block") {
      // The stray marker was stripped from the body.
      expect(op.body).toBe("Electrons orbit the nucleus.");
      expect(op.body).not.toContain("{{attrs");
      // The existing id was passed through unchanged.
      expect(op.blockId).toBe("blk-bbbb2222");
    }
  });

  it("passes existing block ids through operations unchanged", async () => {
    const canned = JSON.stringify({
      task: "reorder for prerequisites",
      summary: "Move ionic bonds after electrons.",
      findings: [],
      operations: [
        {
          op: "reorder-blocks",
          chapterSlug: "ch-1",
          orderedBlockIds: ["blk-bbbb2222", "blk-aaaa1111"],
          rationale: "Electrons should come first.",
        },
        {
          op: "create-block",
          chapterSlug: "ch-2",
          afterBlockId: "blk-cccc3333",
          title: "Covalent Bonds",
          body: "Atoms share electrons.",
          rationale: "Covalent bonds were missing.",
        },
      ],
    });
    const set = await createProviderCoherenceHarness(fakeProvider(canned)).run(SAMPLE);

    const reorder = set.operations[0];
    expect(reorder?.op).toBe("reorder-blocks");
    if (reorder?.op === "reorder-blocks") {
      expect(reorder.orderedBlockIds).toEqual(["blk-bbbb2222", "blk-aaaa1111"]);
    }
    const create = set.operations[1];
    expect(create?.op).toBe("create-block");
    if (create?.op === "create-block") {
      expect(create.afterBlockId).toBe("blk-cccc3333");
      // create-block carries no id of its own.
      expect("blockId" in create).toBe(false);
    }
  });

  it("throws when the provider returns non-JSON garbage", async () => {
    const harness = createProviderCoherenceHarness(
      fakeProvider("I'm sorry, I cannot help with that."),
    );
    await expect(harness.run(SAMPLE)).rejects.toThrow(/invalid JSON|invalid change set/i);
  });

  it("throws when the JSON is well-formed but fails the schema", async () => {
    // Missing the required `summary` field.
    const harness = createProviderCoherenceHarness(
      fakeProvider(JSON.stringify({ task: "x", findings: [], operations: [] })),
    );
    await expect(harness.run(SAMPLE)).rejects.toThrow(/invalid change set/i);
  });
});
