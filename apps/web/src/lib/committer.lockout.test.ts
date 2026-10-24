/**
 * Loop r3 (P5.B.3.g): a published course can never be locked against saves
 * by Alembic's own commits, and the educator always has a way out.
 *
 * Before r3 the synced pointer only advanced when a commit's parent WAS the
 * pointer, so two tabs saving at once — or one failed pointer write — left
 * it behind Alembic's own commit, and every later save of those files was
 * refused forever, pointing at a "Check for outside changes" control that
 * nothing rendered. Now: the pointer advances by compare-and-set from the
 * commit's parent; a refused save brings the outside change in and retries
 * when nothing of its own files really changed; a real outside edit is
 * brought in and the refusal says so; GitHub comparisons that cannot list
 * everything fall back to a whole-tree comparison (P5.B.3.j).
 *
 * Runs the REAL committer, bridge (commitFiles → GitHubClient), synced-pointer
 * helpers, reconcile (reconcilePublicRepo + the repo reader with its tree
 * fallback) and write path (writeThrough over a MemoryPackageStore), over a
 * simulated repository with real file contents and blob ids. Faked:
 * `clientForUser`, and `reconcilePackage`'s registry/discovery bookkeeping
 * (its core — reconcile, then move the pointer unless held back — is kept).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GitHubClient, gitBlobSha, type FetchLike, type FetchResponse } from "@alembic/github-bridge";
import { parseManifest } from "@alembic/package-contract";
import {
  CommitFailedError,
  MemoryPackageStore,
  writeThrough,
  type Committer,
  type PackageRecord,
  type PackageStore,
} from "@alembic/package-ops";

const mocks = vi.hoisted(() => ({ client: null as unknown, reconciles: 0 }));

vi.mock("./github", async () => {
  const synced = await import("./synced-sha");
  const { reconcilePublicRepo } = await import("@alembic/package-ops");
  const { githubRepoReader } = await import("./repo-reader");
  return {
    ...synced,
    clientForUser: async () => ({ client: mocks.client, owner: "prof" }),
    reconcilePackage: async (supabase: SupabaseClient, store: PackageStore, _userId: string, packageId: string) => {
      mocks.reconciles++;
      const outcome = await reconcilePublicRepo(store, packageId, {
        lastSyncedSha: await synced.syncedShaFor(supabase, packageId),
        reader: githubRepoReader(mocks.client as GitHubClient, { owner: "prof", repo: "thermo" }, { store, packageId }),
      });
      if (outcome.status !== "quarantined") await synced.recordSyncedSha(supabase, packageId, outcome.headSha);
      return outcome;
    },
  };
});

// eslint-disable-next-line import/first -- after vi.mock (hoisted) for clarity
import {
  CHANGED_OUTSIDE,
  CHANGED_OUTSIDE_BROUGHT_IN,
  CHANGED_OUTSIDE_HELD_BACK,
  committerFor,
} from "./committer";

/* ── a simulated public repository with contents ───────────────────────── */

type Snapshot = Map<string, string>;
type CompareMode = "ok" | "fails" | "too-many" | "diverged";

function repoState(initial: Record<string, string>) {
  const commits = new Map<string, { parent: string | null; files: Snapshot }>([
    ["c0", { parent: null, files: new Map(Object.entries(initial)) }],
  ]);
  return { head: "c0", n: 0, commits, trees: new Map<string, Snapshot>(), compare: "ok" as CompareMode, writes: 0 };
}
type RepoState = ReturnType<typeof repoState>;

function isAncestor(s: RepoState, base: string, tip: string): boolean {
  for (let at: string | null = tip; at; at = s.commits.get(at)?.parent ?? null) if (at === base) return true;
  return false;
}

/** A change made directly on the hosting site, outside Alembic. */
function foreign(s: RepoState, edits: Record<string, string | null>): string {
  const files = new Map(s.commits.get(s.head)!.files);
  for (const [p, c] of Object.entries(edits)) (c === null ? files.delete(p) : files.set(p, c));
  const sha = `f${++s.n}`;
  s.commits.set(sha, { parent: s.head, files });
  s.head = sha;
  return sha;
}

/** A client over the shared repo state; `gate` delays this client's first request. */
function clientFor(s: RepoState, gate?: Promise<void>) {
  let gated = !!gate;
  const ok = (json: unknown): FetchResponse => ({ ok: true, status: 200, json: async () => json, text: async () => "" });
  const nf: FetchResponse = { ok: false, status: 404, json: async () => ({}), text: async () => "Not Found" };
  const snapshotOf = (ref: string): Snapshot | undefined =>
    s.commits.get(ref)?.files ?? s.trees.get(ref) ?? s.commits.get(ref.replace(/^tree-/, ""))?.files;
  const fetchImpl: FetchLike = async (url, init) => {
    if (gated) {
      gated = false;
      await gate;
    }
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const path = url.replace(/^https:\/\/api\.github\.com\/repos\/prof\/thermo/, "");
    if (method === "GET" && path.startsWith("/git/ref/heads/")) return ok({ object: { sha: s.head } });
    if (method === "GET" && path.startsWith("/git/commits/")) return ok({ tree: { sha: `tree-${path.split("/").pop()}` } });
    if (method === "GET" && path.startsWith("/git/trees/")) {
      const snap = snapshotOf(path.slice("/git/trees/".length).split("?")[0]!);
      if (!snap) return nf;
      return ok({
        tree: [...snap].map(([p, c]) => ({ path: p, type: "blob", sha: gitBlobSha(Buffer.from(c, "utf8")) })),
        truncated: false,
      });
    }
    if (method === "GET" && path.startsWith("/contents/")) {
      const [p, q] = path.slice("/contents/".length).split("?ref=") as [string, string];
      const c = snapshotOf(q)?.get(p);
      return c === undefined ? nf : ok({ content: Buffer.from(c).toString("base64"), encoding: "base64" });
    }
    if (method === "GET" && path.startsWith("/compare/")) {
      const [base, tip] = path.slice("/compare/".length).split("...") as [string, string];
      if (s.compare === "fails" || !s.commits.has(base)) return nf;
      const a = s.commits.get(base)!.files;
      const b = s.commits.get(tip)!.files;
      const files: Array<{ filename: string; status: string }> = [];
      for (const [p, c] of b) if (a.get(p) !== c) files.push({ filename: p, status: a.has(p) ? "modified" : "added" });
      for (const p of a.keys()) if (!b.has(p)) files.push({ filename: p, status: "removed" });
      if (s.compare === "too-many")
        for (let i = files.length; i < 300; i++) files.push({ filename: `padding/${i}.md`, status: "modified" });
      const status = s.compare === "diverged" || !isAncestor(s, base, tip) ? "diverged" : "ahead";
      // A diverged comparison lists the diff from the merge base: model it as "nothing".
      return ok({ status, files: status === "diverged" ? [] : files });
    }
    if (method === "POST" && path === "/git/trees") {
      s.writes++;
      const files = new Map(snapshotOf(body["base_tree"] as string)!);
      for (const e of body["tree"] as Array<{ path: string; content?: string; sha?: string | null }>) {
        if (e.sha === null) files.delete(e.path);
        else files.set(e.path, e.content ?? "");
      }
      const id = `newtree-${++s.n}`;
      s.trees.set(id, files);
      return ok({ sha: id });
    }
    if (method === "POST" && path === "/git/commits") {
      s.writes++;
      const sha = `a${++s.n}`;
      s.commits.set(sha, { parent: (body["parents"] as string[])[0]!, files: s.trees.get(body["tree"] as string)! });
      return ok({ sha });
    }
    if (method === "PATCH" && path.startsWith("/git/refs/heads/")) {
      s.writes++;
      const sha = body["sha"] as string;
      // Real GitHub: fast-forward only.
      if (s.commits.get(sha)?.parent !== s.head)
        return { ok: false, status: 422, json: async () => ({}), text: async () => "Update is not a fast forward" };
      s.head = sha;
      return ok({});
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return new GitHubClient("ghs_x", fetchImpl, { retry: { maxRetries: 0 } });
}

/* ── the `packages` row (last_synced_sha) ──────────────────────────────── */

function packagesTable(initial: string | null, opts: { failUpdates?: number } = {}) {
  const row = { id: "pkg-1", last_synced_sha: initial };
  let failsLeft = opts.failUpdates ?? 0;
  const supabase = {
    from() {
      const filters: Array<(r: typeof row) => boolean> = [];
      let patch: Partial<typeof row> | null = null;
      const run = () => {
        if (patch && failsLeft > 0) {
          failsLeft--;
          return { data: null, error: { message: "network" } };
        }
        const hit = filters.every((f) => f(row));
        if (patch && hit) Object.assign(row, patch);
        return { data: hit ? [{ id: row.id, last_synced_sha: row.last_synced_sha }] : [], error: null };
      };
      const q = {
        select: () => q,
        update: (p: Partial<typeof row>) => ((patch = p), q),
        eq: (c: keyof typeof row, v: unknown) => (filters.push((r) => r[c] === v), q),
        is: (c: keyof typeof row, v: null) => (filters.push((r) => r[c] === v), q),
        maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
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
  title: "T",
  license: "CC-BY-4.0",
  createdAt: "2026-08-28T00:00:00.000Z",
  publicRepo: { owner: "prof", name: "thermo" },
});
const rec: PackageRecord = {
  packageId: "pkg-1",
  ownerId: "u",
  title: "T",
  storage: "github",
  manifest: m,
  repos: { public: { owner: "prof", name: "thermo" }, private: null },
};
const INITIAL = { "study-guide/ch1.md": "# One\n", "study-guide/ch2.md": "# Two\n" };

async function course(initial: Record<string, string> = INITIAL) {
  const s = repoState(initial);
  const store = new MemoryPackageStore();
  await store.createPackage(
    rec,
    Object.entries(initial).map(([path, content]) => ({ repo: "public" as const, path, content })),
  );
  return { s, store };
}

async function committer(table: ReturnType<typeof packagesTable>, store: PackageStore, client: GitHubClient) {
  mocks.client = client;
  const r = await committerFor(table.supabase, store, "u", "pkg-1");
  if (r.kind !== "github") throw new Error(r.kind);
  return r.committer;
}

/** A save through the one write path: commit first, then project. */
const save = (store: PackageStore, c: Committer, path: string, content: string) =>
  writeThrough(store, c, "pkg-1", { summary: "Save", changes: [{ repo: "public", path, content }] });

const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error);
const NO_DEV_WORDS = /\b(git|github|commit|branch|repo|repository|sha|merge|push)\b/i;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.reconciles = 0;
});

describe("no lockout by Alembic's own saves (loop r3, P5.B.3.g)", () => {
  it("[P5.B.3.g] two tabs saving different files at once: the pointer follows both saves and both files stay savable", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const A = await committer(table, store, clientFor(s));
    const B = await committer(table, store, clientFor(s, gate)); // B read synced=c0, then waits
    const pb = save(store, B, "study-guide/ch2.md", "# Two B1\n");
    await new Promise((r) => setTimeout(r, 10));
    await save(store, A, "study-guide/ch1.md", "# One A1\n");
    release();
    await pb;
    expect(table.pointer()).toBe(s.head);

    const C = await committer(table, store, clientFor(s));
    await save(store, C, "study-guide/ch2.md", "# Two B2\n");
    await save(store, C, "study-guide/ch1.md", "# One A2\n");
    expect(s.commits.get(s.head)!.files.get("study-guide/ch2.md")).toBe("# Two B2\n");
    expect(table.pointer()).toBe(s.head);
  });

  it("[P5.B.3.g] a pointer write that fails once is retried and lands", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0", { failUpdates: 1 });
    const A = await committer(table, store, clientFor(s));
    await save(store, A, "study-guide/ch1.md", "# v1\n");
    expect(table.pointer()).toBe(s.head);
  });

  it("[P5.B.3.g] a pointer write that keeps failing after a save does not lock the file: the next save repairs it", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0", { failUpdates: 2 });
    const A = await committer(table, store, clientFor(s));
    await save(store, A, "study-guide/ch1.md", "# v1\n"); // lands; both pointer writes fail
    expect(table.pointer()).toBe("c0");

    await save(store, A, "study-guide/ch1.md", "# v2\n");
    expect(s.commits.get(s.head)!.files.get("study-guide/ch1.md")).toBe("# v2\n");
    expect(table.pointer()).toBe(s.head);
    expect(mocks.reconciles).toBe(1);
  });

  it("[P5.B.3.g] a real outside edit to the same file: refused, nothing written, and the outside version is brought in", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    const f = foreign(s, { "study-guide/ch1.md": "# One, edited online\n" });
    const writesBefore = s.writes;
    const A = await committer(table, store, clientFor(s));
    const err = await refusal(save(store, A, "study-guide/ch1.md", "# One, mine\n"));
    expect(err).toBeInstanceOf(CommitFailedError);
    expect(err!.message).toBe(CHANGED_OUTSIDE_BROUGHT_IN);
    expect(err!.message).toMatch(/brought into Alembic/);
    expect(err!.message).toMatch(/Nothing from this save was written/);
    expect(err!.message).not.toMatch(NO_DEV_WORDS);
    expect(s.writes).toBe(writesBefore);
    expect(s.head).toBe(f);
    expect(await store.readFile("pkg-1", "public", "study-guide/ch1.md")).toBe("# One, edited online\n");
    expect(table.pointer()).toBe(f);

    // The way out: reopen (the store now has the outside version) and save again.
    await save(store, A, "study-guide/ch1.md", "# One, edited online — and mine\n");
    expect(s.commits.get(s.head)!.files.get("study-guide/ch1.md")).toBe("# One, edited online — and mine\n");
  });

  it("[P5.B.3.g] an outside edit Alembic can't accept: plain refusal naming the reachable control, nothing written", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    const dup = "# One\n\n## A {{attrs[#blk-aaaa1111]}}\n\nx\n\n## B {{attrs[#blk-aaaa1111]}}\n\ny\n";
    foreign(s, { "study-guide/ch1.md": dup });
    const writesBefore = s.writes;
    const A = await committer(table, store, clientFor(s));
    const err = await refusal(save(store, A, "study-guide/ch1.md", "# mine\n"));
    expect(err!.message).toBe(CHANGED_OUTSIDE_HELD_BACK);
    expect(err!.message).toMatch(/Check for outside changes/);
    expect(err!.message).not.toMatch(NO_DEV_WORDS);
    expect(s.writes).toBe(writesBefore);
    expect(table.pointer()).toBe("c0");
  });
});

describe("a way out when GitHub's comparison cannot list everything (loop r3, P5.B.3.g / P5.B.3.j)", () => {
  for (const mode of ["fails", "too-many", "diverged"] as const) {
    it(`[P5.B.3.g] comparison ${mode}: an outside edit to OTHER files is brought in by whole-tree comparison and the save goes through`, async () => {
      const { s, store } = await course();
      const table = packagesTable("c0");
      foreign(s, { "study-guide/ch2.md": "# Two, edited online\n" });
      s.compare = mode;
      const A = await committer(table, store, clientFor(s));
      await save(store, A, "study-guide/ch1.md", "# One, mine\n");
      const files = s.commits.get(s.head)!.files;
      expect(files.get("study-guide/ch1.md")).toBe("# One, mine\n");
      expect(files.get("study-guide/ch2.md")).toBe("# Two, edited online\n");
      expect(await store.readFile("pkg-1", "public", "study-guide/ch2.md")).toBe("# Two, edited online\n");
      expect(table.pointer()).toBe(s.head);
    });

    it(`[P5.B.3.g] comparison ${mode}: an outside edit to the SAME file is refused and brought in`, async () => {
      const { s, store } = await course();
      const table = packagesTable("c0");
      const f = foreign(s, { "study-guide/ch1.md": "# One, edited online\n" });
      s.compare = mode;
      const A = await committer(table, store, clientFor(s));
      const err = await refusal(save(store, A, "study-guide/ch1.md", "# One, mine\n"));
      expect(err!.message).toBe(CHANGED_OUTSIDE_BROUGHT_IN);
      expect(s.head).toBe(f);
      expect(await store.readFile("pkg-1", "public", "study-guide/ch1.md")).toBe("# One, edited online\n");
    });
  }
});

describe("the refusal names a control that exists (loop r3, P5.B.3.g)", () => {
  it("[P5.B.3.g] “Check for outside changes” is rendered for published courses and calls the reconcile action", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const dir = fileURLToPath(new URL("../app/workspace/[packageId]/_components/", import.meta.url));
    const control = readFileSync(`${dir}outside-changes-control.tsx`, "utf8");
    const header = readFileSync(`${dir}publish-header.tsx`, "utf8");
    expect(control).toContain('OUTSIDE_CHANGES_LABEL = "Check for outside changes"');
    expect(control).toMatch(/reconcilePackageAction\(packageId\)/);
    expect(header).toMatch(/\{published && <OutsideChangesControl /);
    for (const copy of [CHANGED_OUTSIDE, CHANGED_OUTSIDE_HELD_BACK]) {
      expect(copy).toContain("“Check for outside changes”");
      expect(copy).not.toMatch(NO_DEV_WORDS);
    }
  });
});
