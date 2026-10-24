/**
 * The /d heal's rate bound and scheduling (closed loop r3, P5.A.6.p/r).
 * The heal itself runs against the real migrations in
 * `permalink-heal.sql.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import type { PermalinkDoc } from "./permalink-access";

vi.mock("server-only", () => ({}));
vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));

// eslint-disable-next-line import/first -- after vi.mock (hoisted)
import { createStaleHealer, HealGate } from "./permalink-heal";

const doc = (doc_id: string): PermalinkDoc => ({
  doc_id,
  package_id: "pkg-x",
  repo: "public",
  path: "study-guide/a.md",
  source_hash: "h",
  tombstoned: false,
});

describe("HealGate", () => {
  it("[P5.A.6.r] once per doc per window, and bounded in memory", () => {
    let now = 0;
    const gate = new HealGate(60_000, 100, () => now);
    expect(gate.admit("doc-a")).toBe(true);
    expect(gate.admit("doc-a")).toBe(false);
    now += 59_999;
    expect(gate.admit("doc-a")).toBe(false);
    now += 2;
    expect(gate.admit("doc-a")).toBe(true);
    for (let i = 0; i < 1_000; i++) gate.admit(`doc-${i}`);
    expect(gate.size).toBe(100);
    now += 60_001;
    gate.admit("doc-late");
    expect(gate.size).toBe(1);
  });
});

describe("createStaleHealer", () => {
  it("[P5.A.6.p] heals after the response, never with the bytes read, once per window; failures are logged, not thrown", async () => {
    const runs: Array<() => Promise<void>> = [];
    const healed: unknown[][] = [];
    let fail = false;
    const onStale = createStaleHealer({
      service: () => ({}) as never,
      schedule: (run) => runs.push(run),
      gate: new HealGate(60_000, 100, () => 0),
      heal: async (...args) => {
        if (fail) throw new Error("down");
        healed.push(args);
      },
    });
    onStale(doc("doc-a"));
    onStale(doc("doc-a"));
    expect(runs).toHaveLength(1); // gated
    expect(healed).toHaveLength(0); // nothing before the response
    await runs[0]!();
    expect(healed).toEqual([[{}, doc("doc-a")]]);

    fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onStale(doc("doc-b"));
    await expect(runs[1]!()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("[P5.A.6.p] without a service client nothing is attempted", async () => {
    const runs: Array<() => Promise<void>> = [];
    const heal = vi.fn();
    const onStale = createStaleHealer({ service: () => null, schedule: (run) => runs.push(run), heal });
    onStale(doc("doc-a"));
    await runs[0]!();
    expect(heal).not.toHaveBeenCalled();
  });
});
