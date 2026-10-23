import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GitHubClient } from "@alembic/github-bridge";
import { parseManifest } from "@alembic/package-contract";
import {
  CommitFailedError,
  CommitUnavailableError,
  type PackageRecord,
  type PackageStore,
} from "@alembic/package-ops";

/**
 * `./github` is mocked wholesale: it is a `server-only` module whose import
 * graph (next aliases, `@/` paths) doesn't exist under plain node. Mocking it
 * also keeps these tests about the committer's DECISIONS — trial vs github vs
 * unavailable, and what happens around a commit — rather than about GitHub
 * plumbing. `commitFiles` itself is NOT mocked, so the real two-repo
 * validation runs inside these tests (see the adversarial case).
 */
const mocks = vi.hoisted(() => ({
  clientForUser: vi.fn<
    (...args: unknown[]) => Promise<{ client: GitHubClient; owner: string } | null>
  >(),
  recordOwnCommit: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock("./github", () => ({
  clientForUser: mocks.clientForUser,
  syncedShaFor: async () => "sha-synced",
  recordOwnCommit: mocks.recordOwnCommit,
}));

// eslint-disable-next-line import/first -- after vi.mock (hoisted) for clarity
import { committerFor } from "./committer";

const PUBLIC_PATH = "study-guide/thermochemistry.md";
const PRIVATE_PATH = "private-instructor/answer-keys/thermochemistry.md";

function manifest(repos: {
  publicRepo?: { owner: string; name: string };
  privateRepo?: { owner: string; name: string };
}) {
  return parseManifest({
    schemaVersion: 2,
    packageId: "pkg-1",
    title: "Thermochemistry",
    license: "CC-BY-4.0",
    createdAt: "2026-08-28T00:00:00.000Z",
    ...repos,
  });
}

function store(record: PackageRecord | null): PackageStore {
  return {
    getPackage: vi.fn(async () => record),
  } as unknown as PackageStore;
}

function record(over: Partial<PackageRecord> = {}): PackageRecord {
  const m =
    over.manifest ??
    manifest({
      publicRepo: { owner: "prof", name: "thermo" },
      privateRepo: { owner: "prof", name: "thermo-private" },
    });
  return {
    packageId: "pkg-1",
    ownerId: "user-1",
    title: "Thermochemistry",
    storage: "github",
    manifest: m,
    // What the publish path recorded (packages.public_repo / private_repo);
    // by default the same pair the manifest names.
    repos: { public: m.publicRepo ?? null, private: m.privateRepo ?? null },
    ...over,
  };
}

/** What the bridge's client receives — enough to assert routing and payload. */
interface CommitArgs {
  coords: { owner: string; repo: string };
  branch: string;
  message: string;
  files: Array<{ path: string; content: string | null; encoding?: string }>;
}

/** A GitHubClient double: only `createCommitOnBranch` is ever reached. */
function fakeClient(impl?: () => Promise<{ commitSha: string; parentSha: string }>) {
  const createCommitOnBranch = vi.fn(
    async (_args: CommitArgs) =>
      impl ? await impl() : { commitSha: "sha-abc123", parentSha: "sha-synced" },
  );
  return {
    client: { createCommitOnBranch } as unknown as GitHubClient,
    createCommitOnBranch,
  };
}

const supabase = {} as SupabaseClient;

beforeEach(() => {
  mocks.clientForUser.mockReset();
  mocks.recordOwnCommit.mockReset();
  mocks.recordOwnCommit.mockResolvedValue(undefined);
});

describe("committerFor — which write path is this package on", () => {
  it("resolves a trial package to the DB-only path without touching GitHub", async () => {
    const result = await committerFor(
      supabase,
      store(record({ storage: "sandbox", manifest: manifest({}) })),
      "user-1",
      "pkg-1",
    );
    expect(result.kind).toBe("trial");
    expect(mocks.clientForUser).not.toHaveBeenCalled();
  });

  it("refuses (never degrades to trial) when a published package has no connection", async () => {
    mocks.clientForUser.mockResolvedValue(null);
    const result = await committerFor(supabase, store(record()), "user-1", "pkg-1");
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") throw new Error("unreachable");
    // Educator-facing: plain language, tells them nothing changed, no
    // developer vocabulary.
    expect(result.reason).toMatch(/nothing was changed/i);
    expect(result.reason).not.toMatch(/git|repo|commit|sha|api|token/i);
  });

  it("refuses when a published package has no online home recorded", async () => {
    const result = await committerFor(
      supabase,
      store(record({ manifest: manifest({}) })),
      "user-1",
      "pkg-1",
    );
    expect(result.kind).toBe("unavailable");
    expect(mocks.clientForUser).not.toHaveBeenCalled();
  });

  it("refuses for an unknown package rather than falling back to the DB", async () => {
    const result = await committerFor(supabase, store(null), "user-1", "pkg-1");
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") throw new Error("unreachable");
    expect(result.reason).not.toMatch(/git|repo|commit|sha/i);
  });

  it("resolves a connected published package to a committer", async () => {
    const gh = fakeClient();
    mocks.clientForUser.mockResolvedValue({ client: gh.client, owner: "prof" });
    const result = await committerFor(supabase, store(record()), "user-1", "pkg-1");
    expect(result.kind).toBe("github");
  });
});

describe("the committer itself", () => {
  async function connected(
    impl?: () => Promise<{ commitSha: string; parentSha: string }>,
    rec: PackageRecord = record(),
  ) {
    const gh = fakeClient(impl);
    mocks.clientForUser.mockResolvedValue({ client: gh.client, owner: "prof" });
    const result = await committerFor(supabase, store(rec), "user-1", "pkg-1");
    if (result.kind !== "github") throw new Error(`expected github, got ${result.kind}`);
    return { committer: result.committer, ...gh };
  }

  it("commits to the public repo, returns the sha, and records it", async () => {
    const { committer, createCommitOnBranch } = await connected();
    const out = await committer.commit({
      repo: "public",
      summary: "Save study guide",
      changes: [{ path: PUBLIC_PATH, content: "# Heat\n" }],
    });

    expect(out.commitSha).toBe("sha-abc123");
    expect(createCommitOnBranch).toHaveBeenCalledTimes(1);
    expect(createCommitOnBranch.mock.calls[0]?.[0]).toMatchObject({
      coords: { owner: "prof", repo: "thermo" },
      branch: "main",
      message: "Save study guide",
      files: [{ path: PUBLIC_PATH, content: "# Heat\n" }],
    });
    // Loop r2 (P5.B.3.f): guarded by the synced point, and recorded through
    // the conditional pointer update.
    expect(createCommitOnBranch.mock.calls[0]?.[0]).toMatchObject({ unchangedSince: "sha-synced" });
    expect(mocks.recordOwnCommit).toHaveBeenCalledWith(supabase, "pkg-1", "sha-synced", {
      commitSha: "sha-abc123",
      parentSha: "sha-synced",
    });
  });

  it("routes a private commit to the private repo and records no synced sha", async () => {
    const { committer, createCommitOnBranch } = await connected();
    await committer.commit({
      repo: "private",
      summary: "Save answer key",
      changes: [{ path: PRIVATE_PATH, content: "answers" }],
    });

    expect(createCommitOnBranch.mock.calls[0]?.[0]).toMatchObject({
      coords: { owner: "prof", repo: "thermo-private" },
    });
    // The synced pointer tracks the PUBLIC repo only (that is what reconcile
    // compares against); a private commit must not move it.
    expect(mocks.recordOwnCommit).not.toHaveBeenCalled();
  });

  it("[P5.S.3.e] commits go to the recorded repos, never to the repos a re-pointed manifest names", async () => {
    const rec = record({
      manifest: manifest({
        publicRepo: { owner: "victim", name: "victim-oer" },
        privateRepo: { owner: "victim", name: "victim-private" },
      }),
      repos: { public: { owner: "prof", name: "thermo" }, private: { owner: "prof", name: "thermo-private" } },
    });
    const { committer, createCommitOnBranch } = await connected(undefined, rec);
    await committer.commit({ repo: "public", summary: "Save", changes: [{ path: PUBLIC_PATH, content: "x" }] });
    await committer.commit({ repo: "private", summary: "Save", changes: [{ path: PRIVATE_PATH, content: "y" }] });
    expect(createCommitOnBranch.mock.calls.map((c) => c[0].coords)).toEqual([
      { owner: "prof", repo: "thermo" },
      { owner: "prof", repo: "thermo-private" },
    ]);
  });

  it("[P5.S.3.e] a published package with a manifest repo but none recorded is refused, not committed", async () => {
    const result = await committerFor(
      supabase,
      store(record({ repos: { public: null, private: null } })),
      "user-1",
      "pkg-1",
    );
    expect(result.kind).toBe("unavailable");
    expect(mocks.clientForUser).not.toHaveBeenCalled();
  });

  it("passes binary changes through with their encoding", async () => {
    const { committer, createCommitOnBranch } = await connected();
    await committer.commit({
      repo: "public",
      summary: "Add a figure",
      changes: [
        { path: "assets/figure.png", content: "aGVsbG8=", encoding: "base64" },
      ],
    });
    expect(createCommitOnBranch.mock.calls[0]?.[0]).toMatchObject({
      files: [{ path: "assets/figure.png", encoding: "base64" }],
    });
  });

  it("wraps a failed commit in CommitFailedError and records nothing", async () => {
    const { committer } = await connected(async () => {
      throw new Error("502 Bad Gateway");
    });

    await expect(
      committer.commit({
        repo: "public",
        summary: "Save study guide",
        changes: [{ path: PUBLIC_PATH, content: "# Heat\n" }],
      }),
    ).rejects.toBeInstanceOf(CommitFailedError);
    expect(mocks.recordOwnCommit).not.toHaveBeenCalled();
  });

  it("still reports success when the synced-sha bookkeeping fails", async () => {
    // The commit landed; claiming failure would be a lie ("nothing was
    // changed" would be false). Reconcile self-heals the missed pointer.
    const { committer } = await connected();
    mocks.recordOwnCommit.mockRejectedValue(new Error("db down"));
    const out = await committer.commit({
      repo: "public",
      summary: "Save study guide",
      changes: [{ path: PUBLIC_PATH, content: "# Heat\n" }],
    });
    expect(out.commitSha).toBe("sha-abc123");
  });

  it("reports unavailable — not failed — when there is no private repo to write to", async () => {
    const { committer, createCommitOnBranch } = await connected(undefined, record({
      manifest: manifest({ publicRepo: { owner: "prof", name: "thermo" } }),
    }));

    await expect(
      committer.commit({
        repo: "private",
        summary: "Save answer key",
        changes: [{ path: PRIVATE_PATH, content: "answers" }],
      }),
    ).rejects.toBeInstanceOf(CommitUnavailableError);
    expect(createCommitOnBranch).not.toHaveBeenCalled();
  });

  it("adversarial: a private path in a public plan never reaches the network", async () => {
    const { committer, createCommitOnBranch } = await connected();

    await expect(
      committer.commit({
        repo: "public",
        summary: "Save study guide",
        changes: [
          { path: PUBLIC_PATH, content: "# Heat\n" },
          { path: PRIVATE_PATH, content: "answers" },
        ],
      }),
    ).rejects.toThrow();
    // The two-repo invariant is not a retryable failure: it must surface as
    // the contract's own error, not be laundered into "try again".
    await expect(
      committer.commit({
        repo: "public",
        summary: "Save study guide",
        changes: [{ path: PRIVATE_PATH, content: "answers" }],
      }),
    ).rejects.not.toBeInstanceOf(CommitFailedError);
    expect(createCommitOnBranch).not.toHaveBeenCalled();
    expect(mocks.recordOwnCommit).not.toHaveBeenCalled();
  });
});
