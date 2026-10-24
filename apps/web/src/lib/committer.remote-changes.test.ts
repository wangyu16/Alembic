/**
 * Loop r2 (MEDIUM-4, P5.B.3.f): a save must neither silently revert a change
 * made to the course outside Alembic, nor hide it from "Check for outside
 * changes". Before r2 every public save recorded its result as the last
 * synced point — a foreign change sitting in between became invisible to
 * reconcile forever, and a save of the whole `alembic.json` reverted it.
 *
 * Runs the REAL committer, the REAL bridge (`commitFiles` → GitHubClient)
 * over a simulated repository, and the REAL synced-pointer helpers over an
 * in-memory `packages` row. Only `clientForUser` is faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GitHubClient, type FetchLike, type FetchResponse } from "@alembic/github-bridge";
import { parseManifest } from "@alembic/package-contract";
import { CommitFailedError, type PackageRecord, type PackageStore } from "@alembic/package-ops";

const mocks = vi.hoisted(() => ({ client: null as unknown }));

// The automatic accessibility check after a public commit (owner decision 2):
// server wiring, out of scope here (committer.test.ts pins the hook).
vi.mock("./a11y-auto-server", () => ({ scheduleA11yCheck: () => {} }));
vi.mock("./github", async () => ({
  ...(await import("./synced-sha")),
  clientForUser: async () => ({ client: mocks.client, owner: "prof" }),
}));

// eslint-disable-next-line import/first -- after vi.mock (hoisted) for clarity
import { committerFor } from "./committer";

/* ── a simulated public repository ─────────────────────────────────────── */

interface Commit {
  parent: string | null;
  changed: string[];
}

function simulatedRepo(opts: { compareFails?: boolean } = {}) {
  const commits = new Map<string, Commit>([["c0", { parent: null, changed: [] }]]);
  let head = "c0";
  let n = 0;
  let pendingTree: string[] = [];
  const writes: string[] = [];
  const ok = (json: unknown): FetchResponse => ({ ok: true, status: 200, json: async () => json, text: async () => "" });
  const notFound: FetchResponse = { ok: false, status: 404, json: async () => ({}), text: async () => "Not Found" };

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (method === "GET" && url.includes("/git/ref/heads/")) return ok({ object: { sha: head } });
    if (method === "GET" && url.includes("/git/commits/")) return ok({ tree: { sha: `tree-${url.split("/").pop()}` } });
    if (method === "GET" && url.includes("/compare/")) {
      if (opts.compareFails) return notFound;
      const [base, tip] = url.split("/compare/")[1]!.split("...") as [string, string];
      const files: Array<{ filename: string; status: string }> = [];
      let at: string | null = tip;
      while (at && at !== base) {
        const c = commits.get(at);
        if (!c) return notFound;
        for (const p of c.changed) files.push({ filename: p, status: "modified" });
        at = c.parent;
      }
      if (at !== base) return notFound;
      return ok({ files });
    }
    if (method === "POST" && url.endsWith("/git/trees")) {
      writes.push("tree");
      pendingTree = (body["tree"] as Array<{ path: string }>).map((t) => t.path);
      return ok({ sha: `newtree-${++n}` });
    }
    if (method === "POST" && url.endsWith("/git/commits")) {
      writes.push("commit");
      const sha = `a${++n}`;
      commits.set(sha, { parent: (body["parents"] as string[])[0]!, changed: pendingTree });
      return ok({ sha });
    }
    if (method === "PATCH" && url.includes("/git/refs/heads/")) {
      writes.push("ref");
      head = body["sha"] as string;
      return ok({});
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  };

  return {
    client: new GitHubClient("ghs_x", fetchImpl),
    writes,
    head: () => head,
    /** A change made directly on the hosting site, outside Alembic. */
    foreign(paths: string[]): string {
      const sha = `f${++n}`;
      commits.set(sha, { parent: head, changed: paths });
      head = sha;
      return sha;
    },
  };
}

/* ── the `packages` row (last_synced_sha) ───────────────────────────────── */

function packagesTable(initial: string | null) {
  const row = { id: "pkg-1", last_synced_sha: initial };
  const supabase = {
    from(table: string) {
      expect(table).toBe("packages");
      const filters: Array<(r: typeof row) => boolean> = [];
      let patch: Partial<typeof row> | null = null;
      const run = () => {
        const hit = filters.every((f) => f(row));
        if (patch && hit) Object.assign(row, patch);
        return { data: hit ? [{ id: row.id, last_synced_sha: row.last_synced_sha }] : [], error: null };
      };
      const q = {
        select: () => q,
        update: (p: Partial<typeof row>) => ((patch = p), q),
        eq: (c: keyof typeof row, v: unknown) => (filters.push((r) => r[c] === v), q),
        is: (c: keyof typeof row, v: null) => (filters.push((r) => r[c] === v), q),
        maybeSingle: async () => {
          const r = run();
          return { data: r.data[0] ?? null, error: null };
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { supabase, pointer: () => row.last_synced_sha };
}

/* ── fixtures ──────────────────────────────────────────────────────────── */

const m = parseManifest({
  schemaVersion: 2,
  packageId: "pkg-1",
  title: "Thermochemistry",
  license: "CC-BY-4.0",
  createdAt: "2026-08-28T00:00:00.000Z",
  publicRepo: { owner: "prof", name: "thermo" },
});
const rec: PackageRecord = {
  packageId: "pkg-1",
  ownerId: "user-1",
  title: "Thermochemistry",
  storage: "github",
  manifest: m,
  repos: { public: { owner: "prof", name: "thermo" }, private: null },
};
const store = { getPackage: async () => rec } as unknown as PackageStore;

async function setup(opts: { compareFails?: boolean } = {}) {
  const repo = simulatedRepo(opts);
  mocks.client = repo.client;
  const table = packagesTable("c0");
  const r = await committerFor(table.supabase, store, "user-1", "pkg-1");
  if (r.kind !== "github") throw new Error(r.kind);
  return { repo, table, committer: r.committer };
}

const manifestSave = {
  repo: "public" as const,
  summary: "Update course details",
  changes: [{ path: "alembic.json", content: '{"title":"Thermochemistry II"}\n' }],
};
const chapterSave = {
  repo: "public" as const,
  summary: "Save chapter",
  changes: [{ path: "study-guide/ch1.md", content: "# Heat\n" }],
};

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

describe("saves and changes made outside Alembic (loop r2, MEDIUM-4)", () => {
  it("[P5.B.3.f] an outside change to alembic.json: a course-details save is refused, nothing is written, the pointer stays", async () => {
    const { repo, table, committer } = await setup();
    const foreign = repo.foreign(["alembic.json"]);
    const err = await committer.commit(manifestSave).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CommitFailedError);
    const msg = (err as Error).message;
    expect(msg).toMatch(/outside Alembic/);
    expect(msg).toMatch(/Check for outside changes/);
    expect(msg).toMatch(/nothing was changed/i);
    expect(msg).not.toMatch(/\b(git|github|commit|branch|repo|repository|sha)\b/i);
    expect(repo.writes).toEqual([]);
    expect(repo.head()).toBe(foreign);
    expect(table.pointer()).toBe("c0");
  });

  it("[P5.B.3.f] an outside change to OTHER files: the save goes through but the pointer does not move past the outside change", async () => {
    const { repo, table, committer } = await setup();
    repo.foreign(["study-guide/ch9.md"]);
    const out = await committer.commit(chapterSave);
    expect(repo.head()).toBe(out.commitSha);
    // Still at the old point: "Check for outside changes" will see ch9.md.
    expect(table.pointer()).toBe("c0");
  });

  it("[P5.B.3.f] no outside change: the pointer advances, and two saves in a row advance normally", async () => {
    const { repo, table, committer } = await setup();
    const first = await committer.commit(chapterSave);
    expect(table.pointer()).toBe(first.commitSha);
    const second = await committer.commit(manifestSave);
    expect(table.pointer()).toBe(second.commitSha);
    expect(repo.head()).toBe(second.commitSha);
  });

  it("[P5.B.3.f] when the outside change cannot be compared, the save is refused (fail closed)", async () => {
    const { repo, table, committer } = await setup({ compareFails: true });
    repo.foreign(["study-guide/ch9.md"]);
    await expect(committer.commit(chapterSave)).rejects.toBeInstanceOf(CommitFailedError);
    expect(repo.writes).toEqual([]);
    expect(table.pointer()).toBe("c0");
  });

  it("[P5.B.3.f] the pointer only moves from the value the save started from (atomic)", async () => {
    const { advanceSyncedSha } = await import("./synced-sha");
    const table = packagesTable("c0");
    expect(await advanceSyncedSha(table.supabase, "pkg-1", "zzz", "a9")).toBe(false);
    expect(table.pointer()).toBe("c0");
    expect(await advanceSyncedSha(table.supabase, "pkg-1", "c0", "a9")).toBe(true);
    expect(table.pointer()).toBe("a9");
    const fresh = packagesTable(null);
    expect(await advanceSyncedSha(fresh.supabase, "pkg-1", null, "a1")).toBe(true);
    expect(fresh.pointer()).toBe("a1");
  });
});
