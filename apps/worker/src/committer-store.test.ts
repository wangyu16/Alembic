import { describe, expect, it } from "vitest";
import { SqlQueueStore } from "@alembic/package-ops";
import { bindAll } from "./committer-loop";

describe("the worker's queue store", () => {
  it("[K1.10] passes every SQL store method through to the committer (the ledger check reached the committer)", () => {
    const raw = new SqlQueueStore({ query: async () => ({ rows: [] }) } as never);
    const bound = bindAll(raw) as unknown as Record<string, unknown>;
    for (const m of ["acquire", "next", "finish", "roleOf", "baseText", "blobKnown", "claimCurrent", "recordPlanned", "insert"]) {
      if (typeof (raw as unknown as Record<string, unknown>)[m] === "function") expect(typeof bound[m], m).toBe("function");
    }
    expect(typeof bound.blobKnown).toBe("function");
  });
});
