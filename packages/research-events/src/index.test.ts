import { describe, expect, it } from "vitest";
import {
  createEventLogger,
  ResearchEventSchema,
  type ResearchEvent,
} from "./index";

const sample: ResearchEvent = {
  type: "block.edited",
  userId: "user-1",
  packageId: "pkg-1",
  durationMs: 1200,
  detail: { blockId: "blk-a1b2c3d4" },
  occurredAt: "2026-06-11T12:00:00Z",
};

describe("ResearchEventSchema", () => {
  it("accepts a valid event", () => {
    expect(ResearchEventSchema.safeParse(sample).success).toBe(true);
  });

  it("rejects unknown event types", () => {
    expect(
      ResearchEventSchema.safeParse({ ...sample, type: "made.up" }).success,
    ).toBe(false);
  });
});

describe("createEventLogger", () => {
  it("forwards valid events to the sink", async () => {
    const seen: ResearchEvent[] = [];
    const logger = createEventLogger({
      write: async (e) => {
        seen.push(e);
      },
    });
    await logger.log(sample);
    expect(seen).toHaveLength(1);
  });

  it("swallows sink failures (logging never breaks authoring)", async () => {
    const logger = createEventLogger({
      write: async () => {
        throw new Error("db down");
      },
    });
    await expect(logger.log(sample)).resolves.toBeUndefined();
  });
});
