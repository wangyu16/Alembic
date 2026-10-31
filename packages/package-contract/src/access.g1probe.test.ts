/**
 * G1 adversary probe (permissions v3 §3, design §2.2 row "Use a source's
 * file (agent): only if AI processing allowed").
 */
import { describe, expect, it } from "vitest";
import { canAgent } from "./access";

describe("G1 probe: canAgent and source.use-ai", () => {
  it("the agent may use an AI-allowed source when a member started the job", () => {
    expect(canAgent("owner", "source.use-ai", { aiAllowed: true })).toBe(true);
  });
});
