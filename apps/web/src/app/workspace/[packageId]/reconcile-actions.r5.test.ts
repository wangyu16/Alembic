/**
 * Loop r5 — "Keep Alembic's version" (reconcile-actions.ts):
 *  - P5.B.3.r: when Alembic has no copy of a held-back file, keeping its
 *    version REMOVES the file online — the action says which files, and the
 *    confirmation says "remove" and why; every held-back file carries its
 *    real reason (e.g. text not saved as UTF-8).
 *  - P5.B.3.s: a keep counts against the per-user check bound like a check
 *    (no bypass), and a keep that went through never comes back as
 *    "checked too many times".
 * The actions and the real limiter run; the session, the store, the
 * reconcile, the committer and the write path are doubles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "u-1" } as { id: string },
  reconciles: 0,
  writes: [] as Array<Array<{ path: string; content: string | null }>>,
  stored: new Map<string, string>(),
  outcome: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) } }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => null })); // the in-process counter
vi.mock("@/lib/sandbox-store", () => ({
  SupabaseSandboxStore: class {
    async readFile(_p: string, _r: string, path: string) {
      return mocks.stored.get(path) ?? null;
    }
  },
}));
vi.mock("@/lib/events", () => ({ supabaseEventLogger: () => ({ log: async () => {} }) }));
vi.mock("@/lib/a11y-auto-server", () => ({ scheduleA11yCheck: () => {} }));
vi.mock("@/lib/committer", () => ({ committerFor: async () => ({ kind: "github", committer: {} }) }));
vi.mock("@/lib/github", () => ({
  reconcilePackage: async () => {
    mocks.reconciles++;
    return mocks.outcome;
  },
  scanPublicRepoForLeaks: async () => null,
}));
vi.mock("@alembic/package-ops", async (orig) => ({
  ...(await orig<typeof import("@alembic/package-ops")>()),
  writeThrough: async (_s: unknown, _c: unknown, _id: string, op: { changes: Array<{ path: string; content: string | null }> }) => {
    mocks.writes.push(op.changes.map((c) => ({ path: c.path, content: c.content })));
    mocks.outcome = { status: "up-to-date", headSha: "h2" };
    return { committed: true };
  },
}));

// eslint-disable-next-line import/first -- after vi.mock (hoisted)
import { keepAlembicVersionAction, reconcilePackageAction } from "./reconcile-actions";
// eslint-disable-next-line import/first
import { keepConfirmText } from "./_components/outside-changes-control";

const held = () => ({
  status: "quarantined",
  headSha: "h1",
  violations: [
    "materials/grades.csv: not readable as text",
    "study-guide/ch2.md: duplicate block id blk-aaaa1111",
  ],
  violationPaths: ["materials/grades.csv", "study-guide/ch2.md"],
  changedPaths: [],
});

beforeEach(() => {
  mocks.reconciles = 0;
  mocks.writes = [];
  mocks.stored = new Map([["study-guide/ch2.md", "# Two\n"]]); // no copy of the CSV
  mocks.outcome = held();
});

describe("keep Alembic's version says what it does (loop r5, P5.B.3.r)", () => {
  it("[P5.B.3.r] a held-back file Alembic has no copy of is named as removed on keep, and every file carries its real reason", async () => {
    mocks.user = { id: "u-reasons" };
    const r = await reconcilePackageAction("pkg");
    expect(r.status).toBe("quarantined");
    expect(r.keepable).toEqual(["materials/grades.csv", "study-guide/ch2.md"]);
    expect(r.removedOnKeep).toEqual(["materials/grades.csv"]);
    expect(r.reasons?.["materials/grades.csv"]).toMatch(/isn't saved in the encoding Alembic reads \(UTF-8\)/);
    expect(r.reasons?.["study-guide/ch2.md"]).toMatch(/section markers were damaged/);
    for (const why of Object.values(r.reasons ?? {})) expect(why).not.toMatch(/\b(git|commit|repo|sha|branch)\b/i);
  });

  it("[P5.B.3.r] the confirmation says remove for a file Alembic has no copy of, and why; replace for the rest", () => {
    const both = keepConfirmText(["materials/grades.csv", "study-guide/ch2.md"], ["materials/grades.csv"]);
    expect(both).toMatch(/Keep Alembic's version of study-guide\/ch2\.md\? This replaces/);
    expect(both).toMatch(/And remove materials\/grades\.csv from the online course\? Alembic has no copy of this file \(added outside Alembic, or removed in Alembic\)/);
    const only = keepConfirmText(["materials/grades.csv"], ["materials/grades.csv"]);
    expect(only).toMatch(/^Remove materials\/grades\.csv from the online course\?/);
    expect(only).not.toMatch(/replaces/);
    // What the keep then commits: a deletion for the file with no copy.
  });

  it("[P5.B.3.r] keeping removes exactly the file Alembic has no copy of and writes Alembic's copy of the other", async () => {
    mocks.user = { id: "u-keep-writes" };
    const r = await keepAlembicVersionAction("pkg", "h1", ["materials/grades.csv", "study-guide/ch2.md"]);
    expect(r.ok).toBe(true);
    expect(mocks.writes).toEqual([[{ path: "materials/grades.csv", content: null }, { path: "study-guide/ch2.md", content: "# Two\n" }]]);
  });
});

describe("keep counts against the check bound, consistently (loop r5, P5.B.3.s)", () => {
  it("[P5.B.3.s] a keep at the bound is refused before anything runs; a keep that went through never comes back as checked too many times", async () => {
    mocks.user = { id: "u-bound" };
    for (let i = 0; i < 9; i++) expect((await reconcilePackageAction("pkg")).ok).toBe(true);
    // The 10th unit is the keep itself (one unit for its check-keep-check).
    const kept = await keepAlembicVersionAction("pkg", "h1", ["study-guide/ch2.md"]);
    expect(kept.ok).toBe(true); // before r5: the final re-check was gated → "many times"
    expect(kept.status).toBe("up-to-date");
    expect(mocks.writes).toHaveLength(1);
    // Now at the bound: another keep is refused up front, nothing runs.
    mocks.outcome = held();
    const before = mocks.reconciles;
    const refused = await keepAlembicVersionAction("pkg", "h1", ["study-guide/ch2.md"]);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/checked for outside changes many times/);
    expect(mocks.reconciles).toBe(before); // before r5: the keep ran its reconcile past the bound
    expect(mocks.writes).toHaveLength(1);
  });
});
