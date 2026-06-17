import { describe, expect, it } from "vitest";
import { summarizeUsage, type InvocationRow } from "./usage";

const rows: InvocationRow[] = [
  { user_id: "u1", kind: "draft-section", input_tokens: 100, output_tokens: 50 },
  { user_id: "u1", kind: "worksheet", input_tokens: 200, output_tokens: 100 },
  { user_id: "u2", kind: "draft-section", input_tokens: 10, output_tokens: 5 },
  { user_id: "u2", kind: "draft-section", input_tokens: null, output_tokens: null },
];

describe("summarizeUsage", () => {
  it("totals tokens + calls, treating null as 0", () => {
    const s = summarizeUsage(rows);
    expect(s.totalCalls).toBe(4);
    expect(s.totalInputTokens).toBe(310);
    expect(s.totalOutputTokens).toBe(155);
    expect(s.totalTokens).toBe(465);
  });

  it("groups by kind, sorted by tokens desc", () => {
    const s = summarizeUsage(rows);
    expect(s.byKind[0]).toEqual({ kind: "worksheet", calls: 1, tokens: 300 });
    expect(s.byKind[1]).toEqual({ kind: "draft-section", calls: 3, tokens: 165 });
  });

  it("groups by user, sorted by tokens desc (u1 heaviest)", () => {
    const s = summarizeUsage(rows);
    expect(s.byUser[0]).toEqual({ userId: "u1", calls: 2, tokens: 450 });
    expect(s.byUser[1]).toEqual({ userId: "u2", calls: 2, tokens: 15 });
  });

  it("handles an empty set", () => {
    const s = summarizeUsage([]);
    expect(s.totalCalls).toBe(0);
    expect(s.totalTokens).toBe(0);
    expect(s.byKind).toEqual([]);
  });
});
