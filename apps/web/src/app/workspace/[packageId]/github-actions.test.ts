/**
 * Loop r3 (correctness), L3-1 — P5.B.3.i: publishing never reverts a change
 * made while it ran, and a publish that stopped after the course was recorded
 * as published can be finished.
 *
 * The action runs for real against an in-memory store; GitHub, Supabase and
 * Next are mocked at the module seams.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryPackageStore,
  createSandboxPackage,
  updateManifest,
  writeThrough,
  type CommitPlanInput,
  type PackageFile,
  type PackageRecord,
} from "@alembic/package-ops";

class TestStore extends MemoryPackageStore {
  patch: Partial<PackageRecord> = {};
  failCas = 0;
  override async getPackage(id: string) {
    const r = await super.getPackage(id);
    return r ? { ...r, ...this.patch } : r;
  }
  override async replaceFileIf(
    id: string,
    file: PackageFile,
    expected: { content: string },
  ): ReturnType<MemoryPackageStore["replaceFileIf"]> {
    if (this.failCas > 0) {
      this.failCas -= 1;
      throw new Error("database briefly unavailable");
    }
    return super.replaceFileIf(id, file, expected);
  }
}

const state = {
  store: new TestStore(),
  /** Runs inside the public publish commit — "another tab" acting meanwhile. */
  duringPublicCommit: null as null | (() => Promise<void>),
  bridgeCommits: [] as Array<{ repo: string; changes: Array<{ path: string; content: string | null }> }>,
  committerPlans: [] as CommitPlanInput[],
  flushes: 0,
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/discovery-cache", () => ({ discoveryChanged: vi.fn() }));
vi.mock("@/lib/discovery-flush", () => ({
  flushDiscovery: vi.fn(async () => {
    state.flushes += 1;
  }),
}));
vi.mock("@/lib/events", () => ({ supabaseEventLogger: () => ({ log: async () => {} }) }));
vi.mock("@/lib/export", () => ({ slugForFile: (t: string) => t.toLowerCase().replace(/\W+/g, "-") }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1", user_metadata: {} } } }) },
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { github_installation_id: 7, github_username: "prof" } }),
      };
      return q;
    },
    rpc: async () => ({ error: null }),
  }),
}));
vi.mock("@/lib/sandbox-store", () => ({
  SupabaseSandboxStore: function SupabaseSandboxStore() {
    return state.store;
  },
}));
vi.mock("@/lib/package-trust-writes", () => ({
  packageTrustWriter: () => ({
    recordPublished: async (
      _id: string,
      _user: string,
      r: { publicRepo: { owner: string; name: string }; privateRepo: { owner: string; name: string } },
    ) => {
      state.store.patch = { storage: "github", repos: { public: r.publicRepo, private: r.privateRepo } };
      return { ok: true };
    },
  }),
}));
vi.mock("@/lib/github", () => ({
  githubConfig: () => ({ templateOwner: "t", publicTemplate: "pub", privateTemplate: "priv" }),
  clientForInstallation: async () => ({ generateFromTemplate: async () => {} }),
  clientForUser: async () => null,
  recordOwnCommit: async () => {},
  recordSyncedSha: async () => {},
  syncedShaFor: async () => null,
}));
vi.mock("@/lib/committer", () => ({
  committerFor: async (_s: unknown, store: TestStore, _u: string, id: string) => {
    const r = await store.getPackage(id);
    if (r?.storage !== "github") return { kind: "trial" };
    return {
      kind: "github",
      committer: {
        async commit(plan: CommitPlanInput) {
          state.committerPlans.push(plan);
          return { commitSha: `sha-${state.committerPlans.length}` };
        },
      },
    };
  },
}));
vi.mock("@alembic/github-bridge", async (orig) => ({
  ...(await orig<typeof import("@alembic/github-bridge")>()),
  commitFiles: async (
    _client: unknown,
    _coords: unknown,
    plan: { repo: string; changes: Array<{ path: string; content: string | null }> },
  ) => {
    state.bridgeCommits.push(plan);
    if (plan.repo === "public" && state.duringPublicCommit) {
      const hook = state.duringPublicCommit;
      state.duringPublicCommit = null;
      await hook();
    }
    return { commitSha: `bridge-${state.bridgeCommits.length}` };
  },
}));

const { publishToGitHubAction } = await import("./github-actions");

async function seed() {
  const { packageId } = await createSandboxPackage(state.store, {
    ownerId: "user-1",
    title: "Src",
    license: "CC-BY-4.0",
  });
  return packageId;
}

async function storedManifest(packageId: string) {
  return JSON.parse((await state.store.readFile(packageId, "public", "alembic.json"))!) as {
    title: string;
    publicRepo?: { owner: string; name: string };
    privateRepo?: { owner: string; name: string };
  };
}

beforeEach(() => {
  state.store = new TestStore();
  state.duringPublicCommit = null;
  state.bridgeCommits = [];
  state.committerPlans = [];
  state.flushes = 0;
});

describe("publishing keeps what changed meanwhile (loop r3, P5.B.3.i)", () => {
  it("[P5.B.3.i] a rename made in another tab while publishing survives, in the store and the online copy", async () => {
    const packageId = await seed();
    state.duringPublicCommit = async () => {
      await updateManifest(state.store, null, packageId, (m) => ({ ...m, title: "Renamed in other tab" }));
    };

    const res = await publishToGitHubAction(packageId);
    expect(res.ok).toBe(true);

    const m = await storedManifest(packageId);
    expect(m.title).toBe("Renamed in other tab");
    expect(m.publicRepo?.owner).toBe("prof");
    expect(m.privateRepo?.name).toMatch(/-private$/);
    // The online copy got the merged details too (the publish commit carried
    // the snapshot, which lacked the rename).
    const online = state.committerPlans.flatMap((p) => p.changes).filter((c) => c.path === "alembic.json");
    expect(online).toHaveLength(1);
    expect(JSON.parse(online[0]!.content!)).toMatchObject({ title: "Renamed in other tab", publicRepo: m.publicRepo });
  });

  it("[P5.B.3.i] an undisturbed publish saves nothing extra online", async () => {
    const packageId = await seed();
    const res = await publishToGitHubAction(packageId);
    expect(res.ok).toBe(true);
    expect((await storedManifest(packageId)).publicRepo?.owner).toBe("prof");
    expect(state.committerPlans).toEqual([]);
    expect(state.flushes).toBe(1);
  });

  it("[P5.B.3.i] a publish that stopped after the course was recorded as published is finished by the next click", async () => {
    const packageId = await seed();
    // The details update after recording fails (briefly unavailable store).
    state.store.failCas = 1;
    const first = await publishToGitHubAction(packageId);
    expect(first.ok).toBe(false);
    expect(first.error).not.toMatch(/git|commit|repo/i);
    expect((await state.store.getPackage(packageId))!.storage).toBe("github");
    expect((await storedManifest(packageId)).publicRepo).toBeUndefined();
    const flushesBefore = state.flushes;

    // Next click: recorded as published — finish instead of returning early.
    const second = await publishToGitHubAction(packageId);
    expect(second.ok).toBe(true);
    const m = await storedManifest(packageId);
    expect(m.publicRepo?.owner).toBe("prof");
    expect(m.privateRepo?.name).toMatch(/-private$/);
    expect(state.flushes).toBe(flushesBefore + 1);
    // No new repositories, no second publish commit.
    expect(state.bridgeCommits.filter((c) => c.repo === "public")).toHaveLength(1);

    // A third click on a finished course changes nothing.
    const plans = state.committerPlans.length;
    const before = await state.store.readFile(packageId, "public", "alembic.json");
    expect((await publishToGitHubAction(packageId)).ok).toBe(true);
    expect(state.committerPlans.length).toBe(plans);
    expect(await state.store.readFile(packageId, "public", "alembic.json")).toBe(before);
  });
});

describe("saves made while publishing reach the online copy (loop r4, P5.B.3.o)", () => {
  it("[P5.B.3.o] a save, a new file and a deletion made in another tab while publishing are committed once the course is published", async () => {
    const packageId = await seed();
    await writeThrough(state.store, null, packageId, {
      summary: "s",
      changes: [
        { repo: "public", path: "study-guide/01.md", content: "# One\n" },
        { repo: "public", path: "study-guide/02.md", content: "# Two\n" },
      ],
    });
    state.duringPublicCommit = async () => {
      // A trial save (the course is not recorded as published yet).
      await writeThrough(state.store, null, packageId, {
        summary: "other tab",
        changes: [
          { repo: "public", path: "study-guide/01.md", content: "# One, edited meanwhile\n" },
          { repo: "public", path: "study-guide/03.md", content: "# Three, new meanwhile\n" },
          { repo: "public", path: "study-guide/02.md", content: null },
          { repo: "private", path: "private-instructor/notes.md", content: "notes\n" },
        ],
      });
    };
    const res = await publishToGitHubAction(packageId);
    expect(res.ok).toBe(true);
    const late = state.committerPlans.filter((p) => p.summary.startsWith("Save changes made while publishing"));
    const pub = late.find((p) => p.repo === "public")!;
    expect(pub.changes).toEqual(
      expect.arrayContaining([
        { path: "study-guide/01.md", content: "# One, edited meanwhile\n" },
        { path: "study-guide/03.md", content: "# Three, new meanwhile\n" },
        { path: "study-guide/02.md", content: null },
      ]),
    );
    expect(pub.changes.map((c) => c.path)).not.toContain("alembic.json");
    expect(late.find((p) => p.repo === "private")!.changes).toEqual([{ path: "private-instructor/notes.md", content: "notes\n" }]);
  });

  it("[P5.B.3.o] a catch-up that a newer save has superseded is skipped, not written over it", async () => {
    const { commitLateSaves } = await import("@/lib/publish-catchup");
    const store = new MemoryPackageStore();
    await store.putFiles("p", [{ repo: "public", path: "study-guide/01.md", content: "# Meanwhile\n" }]);
    const plans: CommitPlanInput[] = [];
    const done = await commitLateSaves({
      store,
      packageId: "p",
      committed: new Map([["public:study-guide/01.md", "# Published\n"]]),
      committer: {
        async commit(plan) {
          plans.push(plan);
          // The educator saves again before this commit is made.
          await store.putFiles("p", [{ repo: "public", path: "study-guide/01.md", content: "# Newer\n" }]);
          await plan.recheck!();
          return { commitSha: "x" };
        },
      },
    });
    expect(plans).toHaveLength(1);
    expect(done).toEqual([]);
  });
});

