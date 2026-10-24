/**
 * Owner decision 2 (2026-10-24): the automatic accessibility check — the
 * runner's outcomes and the scheduler's debounce and bounds. (End to end over
 * the real migrations: `decisions-a11y.sql.test.ts`.)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseManifest } from "@alembic/package-contract";
import type { PackageRecord, PackageStore } from "@alembic/package-ops";

vi.mock("server-only", () => ({}));

import { A11yAutoScheduler, runPublishedA11yCheck, type RequestResult } from "./a11y-auto";

const MANIFEST = JSON.stringify({ schemaVersion: 2, packageId: "pkg-1", title: "T", license: "CC-BY-4.0", createdAt: "2026-08-28T00:00:00.000Z" });
const CLEAN = "## Intro {#b-aaaaaaaa}\n\nPlain prose with nothing to flag.\n";

const record = (over: Partial<PackageRecord> = {}): PackageRecord => ({
  packageId: "pkg-1",
  ownerId: "u",
  title: "T",
  storage: "github",
  manifest: parseManifest(JSON.parse(MANIFEST)),
  repos: { public: { owner: "prof", name: "thermo" }, private: null },
  ...over,
});
const store = (rec: PackageRecord) => ({ getPackage: async () => rec, readFile: async () => CLEAN }) as unknown as PackageStore;
const reader = (head = "h1") => ({
  getBranchHead: async () => ({ commitSha: head }),
  getFileAtRef: async (_c: unknown, path: string) => (path === "alembic.json" ? MANIFEST : CLEAN),
});

describe("runPublishedA11yCheck", () => {
  it("[P5.R.5.a] audits the published head and records it with that head; a refused record (head moved) is superseded", async () => {
    const recorded: unknown[] = [];
    const ok = await runPublishedA11yCheck("pkg-1", {
      store: store(record()),
      userId: "u",
      connect: async () => reader("h1"),
      record: async (v) => (recorded.push(v), { ok: true }),
      now: () => new Date("2026-10-24T00:00:00Z"),
    });
    expect(ok).toEqual({ kind: "recorded", status: "pass", errorCount: 0, warningCount: 0, headSha: "h1", checkedAt: "2026-10-24T00:00:00.000Z" });
    expect(recorded).toEqual([{ status: "pass", checkedAt: "2026-10-24T00:00:00.000Z", checkedSha: "h1" }]);
    const moved = await runPublishedA11yCheck("pkg-1", {
      store: store(record()),
      userId: "u",
      connect: async () => reader("h1"),
      record: async () => ({ ok: false, reason: "not-found" }),
    });
    expect(moved.kind).toBe("superseded");
  });

  it("[P5.R.5.d] never throws: unreadable, failing, unsaved, trial and someone else's course record nothing", async () => {
    const never = async () => {
      throw new Error("must not record");
    };
    const run = (over: Partial<Parameters<typeof runPublishedA11yCheck>[1]>) =>
      runPublishedA11yCheck("pkg-1", { store: store(record()), userId: "u", connect: async () => reader(), record: never, ...over });
    expect((await run({ connect: async () => null })).kind).toBe("unavailable");
    expect((await run({ connect: async () => { throw new Error("token"); } })).kind).toBe("failed");
    expect((await run({ store: store(record({ storage: "sandbox" })) })).kind).toBe("trial");
    expect((await run({ store: store(record({ ownerId: "someone-else" })) })).kind).toBe("unavailable");
    expect((await run({ record: async () => ({ ok: false, reason: "no-service-client" }) })).kind).toBe("unavailable");
  });
});

describe("A11yAutoScheduler (debounce and bounds)", () => {
  const manual = () => {
    const tasks: Array<() => Promise<void>> = [];
    return { tasks, schedule: (t: () => Promise<void>) => void tasks.push(t) };
  };

  it("[P5.R.5.b] one run per course at a time; saves during a run coalesce into ONE follow-up with the newest request", async () => {
    const m = manual();
    const s = new A11yAutoScheduler({ schedule: m.schedule, settleMs: 0 });
    const runs: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    expect(s.request("p", async () => (runs.push("first"), gate))).toBe("scheduled");
    expect(m.tasks).toHaveLength(1);
    const done = m.tasks[0]!();
    await vi.waitFor(() => expect(runs).toEqual(["first"]));
    expect(s.request("p", async () => runs.push("second"))).toBe("coalesced");
    expect(s.request("p", async () => runs.push("third"))).toBe("coalesced");
    expect(m.tasks).toHaveLength(1); // nothing new scheduled
    release();
    await done;
    expect(runs).toEqual(["first", "third"]);
    expect(s.size).toBe(0);
  });

  it("[P5.R.5.b] a short settle delay lets a burst of saves share the first run", async () => {
    const m = manual();
    let wake!: () => void;
    const s = new A11yAutoScheduler({ schedule: m.schedule, settleMs: 1500, sleep: () => new Promise<void>((r) => (wake = r)) });
    const runs: number[] = [];
    s.request("p", async () => runs.push(1));
    const done = m.tasks[0]!();
    s.request("p", async () => runs.push(2));
    s.request("p", async () => runs.push(3));
    wake();
    await done;
    expect(runs).toEqual([3]);
  });

  it("[P5.R.5.b] bounded: at most maxConcurrent courses at once, at most maxRuns per task, and the rate gate stops a run", async () => {
    const m = manual();
    const s = new A11yAutoScheduler({ schedule: m.schedule, settleMs: 0, maxConcurrent: 2, maxRuns: 2 });
    expect(s.request("a", async () => {})).toBe("scheduled");
    expect(s.request("b", async () => {})).toBe("scheduled");
    expect(s.request("c", async () => {})).toBe("busy");

    // a course saved in a loop: the task stops after maxRuns
    const loop = new A11yAutoScheduler({ schedule: m.schedule, settleMs: 0, maxRuns: 2 });
    let n = 0;
    const again = (): RequestResult => loop.request("x", async () => (n++, again()));
    again();
    await m.tasks.at(-1)!();
    expect(n).toBe(2);

    // the per-course rate gate
    const gated = new A11yAutoScheduler({ schedule: m.schedule, settleMs: 0, allow: async () => false });
    let ran = false;
    gated.request("y", async () => void (ran = true));
    await m.tasks.at(-1)!();
    expect(ran).toBe(false);
    expect(gated.size).toBe(0);
  });

  it("[P5.R.5.d] a failing check, a throwing gate or a failing scheduler never throws to the caller", async () => {
    const m = manual();
    const s = new A11yAutoScheduler({ schedule: m.schedule, settleMs: 0, allow: async () => { throw new Error("db"); } });
    let ran = 0;
    s.request("p", async () => { ran++; throw new Error("boom"); });
    await expect(m.tasks[0]!()).resolves.toBeUndefined();
    expect(ran).toBe(1); // a broken gate lets the run through
    const broken = new A11yAutoScheduler({ schedule: () => { throw new Error("no after"); } });
    expect(broken.request("p", async () => {})).toBe("busy");
    expect(broken.size).toBe(0);
  });
});

describe("where the automatic check is triggered", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

  it("[P5.R.5.a] after every public commit (committer), every publish and every absorbed outside change", () => {
    const committer = read("committer.ts");
    expect(committer).toMatch(/onPublicCommit: \(\) => scheduleA11yCheck\(userId, packageId\)/);
    const publish = read("../app/workspace/[packageId]/github-actions.ts");
    const action = publish.slice(publish.indexOf("export async function publishToGitHubAction"));
    expect(action).toMatch(/discoveryChanged\(\);\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*scheduleA11yCheck\(user\.id, packageId\);/);
    const reconcile = read("../app/workspace/[packageId]/reconcile-actions.ts");
    expect(reconcile).toMatch(/outcome\.status === "absorbed"\) \{[\s\S]{0,400}scheduleA11yCheck\(user\.id, packageId\);/);
  });
});
