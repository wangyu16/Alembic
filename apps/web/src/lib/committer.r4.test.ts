/**
 * Loop r4 (part A) — the committer, reconcile and editor saves, over the same
 * simulated repository as the r3 lockout test (real committer, bridge,
 * synced-pointer helpers, reconcile and repo reader, write path), extended
 * with the git blobs API, files over the contents API's 1 MB inline limit,
 * binaries, and a hook before the branch is moved.
 *
 *  - P5.B.3.k (HIGH-3): reconcile compares blob ids before reading, reads
 *    binaries and > 1 MB files exactly (stored base64 / full text), never
 *    stores mangled or empty text, and holds back text that isn't text
 *    (probes R4-5, R4-6).
 *  - P5.B.3.l (HIGH-4): a held-back outside change no longer locks the course
 *    file by file; "keep Alembic's version" overwrites only what was seen
 *    (probe R4-7).
 *  - P5.B.3.m (MEDIUM-2/3): an editor save based on a version that is no
 *    longer the stored one is refused, also on the retry after a reconcile
 *    (probes R4-2, R4-3, R4-4).
 *  - P5.B.3.n (R4-1): a branch that moved under a commit is rebuilt and
 *    retried once, the outside-change guard running again.
 *  - P5.B.3.g: the clauses the r3 auditor found unasserted (retried once,
 *    refused again after reconcile, reconcile failure).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GitHubClient, gitBlobSha, type FetchLike, type FetchResponse } from "@alembic/github-bridge";
import { parseManifest, sha256Hex } from "@alembic/package-contract";
import {
  CommitFailedError,
  FILE_CHANGED_SINCE_OPENED,
  FileChangedSinceOpenedError,
  MemoryPackageStore,
  writeThrough,
  type Committer,
  type PackageRecord,
  type PackageStore,
} from "@alembic/package-ops";

const mocks = vi.hoisted(() => ({ client: null as unknown, reconciles: 0, failReconcile: false }));

// The automatic accessibility check after a public commit (owner decision 2):
// server wiring, out of scope here (committer.test.ts pins the hook).
vi.mock("./a11y-auto-server", () => ({ scheduleA11yCheck: () => {} }));
vi.mock("./github", async () => {
  const synced = await import("./synced-sha");
  const { reconcilePublicRepo } = await import("@alembic/package-ops");
  const { githubRepoReader } = await import("./repo-reader");
  return {
    ...synced,
    clientForUser: async () => ({ client: mocks.client, owner: "prof" }),
    reconcilePackage: async (supabase: SupabaseClient, store: PackageStore, _userId: string, packageId: string) => {
      mocks.reconciles++;
      if (mocks.failReconcile) throw new Error("reconcile: network");
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
// eslint-disable-next-line import/first
import { saveFailureMessage } from "./editor-save";

/* ── a simulated public repository with contents ───────────────────────── */

type Snapshot = Map<string, string>;
type CompareMode = "ok" | "fails" | "too-many" | "diverged";

function repoState(initial: Record<string, string>) {
  const commits = new Map<string, { parent: string | null; files: Snapshot }>([
    ["c0", { parent: null, files: new Map(Object.entries(initial)) }],
  ]);
  return {
    head: "c0",
    n: 0,
    commits,
    trees: new Map<string, Snapshot>(),
    compare: "ok" as CompareMode,
    writes: 0,
    /** Paths whose bytes were downloaded (contents or blobs API). */
    reads: [] as string[],
    blobs: new Map<string, string>(),
    /** Called (and awaited) before each PATCH of the branch. */
    beforePatch: null as null | (() => Promise<void>),
  };
}
type RepoState = ReturnType<typeof repoState>;

function isAncestor(s: RepoState, base: string, tip: string): boolean {
  for (let at: string | null = tip; at; at = s.commits.get(at)?.parent ?? null) if (at === base) return true;
  return false;
}

/** A file's bytes: "B64:…" is a binary written as base64, anything else UTF-8. */
function bytesOf(c: string): Buffer {
  return c.startsWith("B64:") ? Buffer.from(c.slice(4), "base64") : Buffer.from(c, "utf8");
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
        tree: [...snap].map(([p, c]) => ({ path: p, type: "blob", sha: gitBlobSha(bytesOf(c)) })),
        truncated: false,
      });
    }
    if (method === "GET" && path.startsWith("/contents/")) {
      const [p, q] = path.slice("/contents/".length).split("?ref=") as [string, string];
      const c = snapshotOf(q)?.get(p);
      if (c === undefined) return nf;
      const bytes = bytesOf(c);
      const sha = gitBlobSha(bytes);
      s.blobs.set(sha, c);
      // Real GitHub: the contents API inlines files up to 1 MB only.
      if (bytes.length > 1_000_000) return ok({ content: "", encoding: "none", sha, size: bytes.length });
      s.reads.push(p);
      return ok({ content: bytes.toString("base64"), encoding: "base64", sha, size: bytes.length });
    }
    if (method === "GET" && path.startsWith("/git/blobs/")) {
      const c = s.blobs.get(path.slice("/git/blobs/".length));
      if (c === undefined) return nf;
      s.reads.push(`blob:${path.slice("/git/blobs/".length)}`);
      return ok({ content: bytesOf(c).toString("base64"), encoding: "base64" });
    }
    if (method === "POST" && path === "/git/blobs") {
      const c = `B64:${body["content"] as string}`;
      const sha = gitBlobSha(bytesOf(c));
      s.blobs.set(sha, c);
      return ok({ sha });
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
        else files.set(e.path, e.content ?? s.blobs.get(e.sha!) ?? "");
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
      if (s.beforePatch) {
        const hook = s.beforePatch;
        s.beforePatch = null;
        await hook();
      }
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

/** An editor's save: based on the stored version it opened (loop r4, P5.B.3.m). */
const editorSave = (store: PackageStore, c: Committer, path: string, content: string, baseHash: string | null) =>
  writeThrough(store, c, "pkg-1", { summary: "Save", changes: [{ repo: "public", path, content, baseHash }] });

/** What an editor opening `path` now is based on. */
async function opened(store: PackageStore, path: string): Promise<string | null> {
  const c = await store.readFile("pkg-1", "public", path);
  return c === null ? null : sha256Hex(c);
}

const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error);
const NO_DEV_WORDS = /\b(git|github|commit|branch|repo|repository|sha|merge|push)\b/i;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.reconciles = 0;
  mocks.failReconcile = false;
});

async function reconcileNow(table: ReturnType<typeof packagesTable>, store: PackageStore, s: RepoState) {
  const { reconcilePackage } = await import("./github");
  mocks.client = clientFor(s);
  return reconcilePackage(table.supabase, store, "u", "pkg-1");
}

const head = (s: RepoState, p: string) => s.commits.get(s.head)!.files.get(p);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80, 0x90]).toString("base64");
/** A block-id corruption the reconcile holds back (duplicate ids). */
const BROKEN = "# Two\n\n## A {{attrs[#blk-aaaa1111]}}\n\nx\n\n## B {{attrs[#blk-aaaa1111]}}\n\ny\n";

describe("reconcile reads exactly, by blob id first (loop r4, P5.B.3.k)", () => {
  it("[P5.B.3.k] Alembic's own picture in a reconcile range stays the same base64 bytes, and is never downloaded (R4-6)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0", { failUpdates: 2 }); // the pointer write fails: the commit stays in range
    const A = await committer(table, store, clientFor(s));
    await writeThrough(store, A, "pkg-1", {
      summary: "img",
      changes: [{ repo: "public", path: "assets/fig.png", content: PNG, encoding: "base64" }],
    });
    expect(table.pointer()).toBe("c0");
    s.reads.length = 0;
    const r = await reconcileNow(table, store, s);
    expect(r?.status).toBe("absorbed");
    if (r?.status === "absorbed") expect(r.changedPaths).toEqual([]);
    expect(await store.readFile("pkg-1", "public", "assets/fig.png")).toBe(PNG);
    expect(s.reads).toEqual([]);
  });

  it("[P5.B.3.k] a picture changed outside is brought in as the base64 of its new bytes", async () => {
    const { s, store } = await course({ ...INITIAL, "assets/fig.png": `B64:${PNG}` });
    await store.putFiles("pkg-1", [{ repo: "public", path: "assets/fig.png", content: PNG }]);
    const table = packagesTable("c0");
    const next = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xde, 0xad, 0xbe, 0xef, 0x00]).toString("base64");
    foreign(s, { "assets/fig.png": `B64:${next}` });
    const r = await reconcileNow(table, store, s);
    expect(r?.status).toBe("absorbed");
    expect(await store.readFile("pkg-1", "public", "assets/fig.png")).toBe(next);
  });

  it("[P5.B.3.k] a file over the 1 MB inline limit changed outside is brought in whole, never as an empty file (R4-5)", async () => {
    const { s, store } = await course({ ...INITIAL, "slides/big.slides.html": "<html>old big deck</html>" });
    const table = packagesTable("c0");
    const big = `<html>${"x".repeat(1_200_000)}</html>`;
    foreign(s, { "slides/big.slides.html": big });
    const r = await reconcileNow(table, store, s);
    expect(r?.status).toBe("absorbed");
    expect(await store.readFile("pkg-1", "public", "slides/big.slides.html")).toBe(big);
    expect(table.pointer()).toBe(s.head);
  });

  it("[P5.B.3.k] a text file whose bytes are not text is held back, never stored with replacement characters", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": `B64:${PNG}` });
    const r = await reconcileNow(table, store, s);
    expect(r?.status).toBe("quarantined");
    if (r?.status === "quarantined") expect(r.violationPaths).toEqual(["study-guide/ch2.md"]);
    expect(await store.readFile("pkg-1", "public", "study-guide/ch2.md")).toBe("# Two\n");
    expect(table.pointer()).toBe("c0");
  });
});

describe("a held-back outside change does not lock the course (loop r4, P5.B.3.l)", () => {
  it("[P5.B.3.l] other files keep saving, again and again, new ones too; only the held-back file is refused, and the synced point stays before it (R4-7)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": BROKEN });
    const A = await committer(table, store, clientFor(s));
    await save(store, A, "study-guide/ch1.md", "# One v1\n");
    await save(store, A, "study-guide/ch1.md", "# One v2\n"); // r3: refused (held back)
    await save(store, A, "study-guide/ch3.md", "# Three\n");
    await save(store, A, "study-guide/ch3.md", "# Three v2\n"); // r3: refused
    expect(head(s, "study-guide/ch1.md")).toBe("# One v2\n");
    expect(head(s, "study-guide/ch3.md")).toBe("# Three v2\n");
    expect(table.pointer()).toBe("c0"); // never moved past the held-back change
    const writes = s.writes;
    const err = await refusal(save(store, A, "study-guide/ch2.md", "# Two, fixed in Alembic\n"));
    expect(err).toBeInstanceOf(CommitFailedError);
    expect(err!.message).toBe(CHANGED_OUTSIDE_HELD_BACK);
    expect(err!.message).not.toMatch(NO_DEV_WORDS);
    expect(s.writes).toBe(writes);
    expect(head(s, "study-guide/ch2.md")).toBe(BROKEN);
  });

  it("[P5.B.3.l] a clean outside edit held back WITH a broken one blocks its own file too (its outside version can't be brought in yet)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": BROKEN, "study-guide/ch1.md": "# One, co-author\n" });
    const A = await committer(table, store, clientFor(s));
    await save(store, A, "study-guide/ch3.md", "# Three\n"); // untouched: saves
    await save(store, A, "study-guide/ch3.md", "# Three v2\n");
    const err = await refusal(save(store, A, "study-guide/ch1.md", "# One, mine\n"));
    expect(err?.message).toBe(CHANGED_OUTSIDE_HELD_BACK);
    expect(head(s, "study-guide/ch1.md")).toBe("# One, co-author\n");
  });

  it("[P5.B.3.l] keeping Alembic's version overwrites exactly the change that was seen; the course is then in step and the file saves", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": BROKEN });
    const seen = await reconcileNow(table, store, s);
    expect(seen?.status).toBe("quarantined");
    const A = await committer(table, store, clientFor(s));
    // What keepAlembicVersionAction does: Alembic's copy, over the seen head.
    await writeThrough(store, A, "pkg-1", {
      summary: "Keep Alembic's version (Alembic)",
      changes: [{ repo: "public", path: "study-guide/ch2.md", content: (await store.readFile("pkg-1", "public", "study-guide/ch2.md"))! }],
      overwriteSeenAt: seen!.headSha,
    });
    expect(head(s, "study-guide/ch2.md")).toBe("# Two\n");
    const after = await reconcileNow(table, store, s);
    expect(after?.status).toBe("absorbed");
    expect(table.pointer()).toBe(s.head);
    await save(store, A, "study-guide/ch2.md", "# Two v2\n");
    expect(head(s, "study-guide/ch2.md")).toBe("# Two v2\n");
  });

  it("[P5.B.3.l] keeping Alembic's version never overwrites a change made after the one that was seen", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": BROKEN });
    const seen = await reconcileNow(table, store, s);
    foreign(s, { "study-guide/ch2.md": "# Two, fixed online meanwhile\n" });
    const A = await committer(table, store, clientFor(s));
    const err = await refusal(
      writeThrough(store, A, "pkg-1", {
        summary: "Keep",
        changes: [{ repo: "public", path: "study-guide/ch2.md", content: "# Two\n" }],
        overwriteSeenAt: seen!.headSha,
      }),
    );
    expect(err).toBeInstanceOf(CommitFailedError);
    expect(head(s, "study-guide/ch2.md")).toBe("# Two, fixed online meanwhile\n");
  });

  it("[P5.B.3.l] the outside-changes control says what is blocked and offers to keep Alembic's version", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "..", "app", "workspace", "[packageId]");
    const control = readFileSync(join(dir, "_components", "outside-changes-control.tsx"), "utf8");
    const actions = readFileSync(join(dir, "reconcile-actions.ts"), "utf8");
    expect(control).toContain("keepAlembicVersionAction(packageId, at, kept)");
    expect(control).toContain("Every other");
    expect(control).not.toContain("those files can't be saved here.");
    expect(actions).toMatch(/export async function keepAlembicVersionAction\(/);
    expect(actions).toContain("overwriteSeenAt: seenAt");
    expect(actions).toContain("now.headSha !== seenAt");
  });
});

describe("an editor save is based on the version it opened (loop r4, P5.B.3.m)", () => {
  it("[P5.B.3.m] two tabs, one file, one after the other: the tab that never saw the other's save is refused (R4-2)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    const A = await committer(table, store, clientFor(s));
    const B = await committer(table, store, clientFor(s));
    const baseA = await opened(store, "study-guide/ch1.md");
    const baseB = await opened(store, "study-guide/ch1.md");
    await editorSave(store, A, "study-guide/ch1.md", "# One + A\n", baseA);
    const writes = s.writes;
    const err = await refusal(editorSave(store, B, "study-guide/ch1.md", "# One + B\n", baseB));
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(err!.message).toBe(FILE_CHANGED_SINCE_OPENED);
    expect(err!.message).not.toMatch(NO_DEV_WORDS);
    expect(s.writes).toBe(writes);
    expect(head(s, "study-guide/ch1.md")).toBe("# One + A\n");
    expect(saveFailureMessage(err)).toEqual({ message: FILE_CHANGED_SINCE_OPENED, retryable: false });
  });

  it("[P5.B.3.m] two tabs at once: the refused save's retry after reconcile is refused too, never written over the other (R4-3)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = await opened(store, "study-guide/ch1.md");
    const A = await committer(table, store, clientFor(s));
    const B = await committer(table, store, clientFor(s, gate)); // B has read the synced point
    const pb = refusal(editorSave(store, B, "study-guide/ch1.md", "# One + B\n", base));
    await new Promise((r) => setTimeout(r, 10));
    await editorSave(store, A, "study-guide/ch1.md", "# One + A\n", base);
    release();
    const err = await pb;
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(mocks.reconciles).toBe(1);
    expect(head(s, "study-guide/ch1.md")).toBe("# One + A\n");
  });

  it("[P5.B.3.m] an outside fix brought in by another tab's save is never overwritten by a tab opened before it (R4-4)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0", { failUpdates: 2 });
    const tab1Base = await opened(store, "study-guide/ch2.md"); // tab 1 opens ch2
    const T2 = await committer(table, store, clientFor(s));
    await save(store, T2, "study-guide/ch1.md", "# v1\n"); // pointer stuck at c0
    foreign(s, { "study-guide/ch2.md": "# Two, co-author's fix online\n" });
    await save(store, T2, "study-guide/ch1.md", "# v2\n"); // refused → reconcile brings ch2 in → retried
    expect(await store.readFile("pkg-1", "public", "study-guide/ch2.md")).toBe("# Two, co-author's fix online\n");
    const T1 = await committer(table, store, clientFor(s));
    const err = await refusal(editorSave(store, T1, "study-guide/ch2.md", "# Two, tab 1 edit on the OLD text\n", tab1Base));
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(head(s, "study-guide/ch2.md")).toBe("# Two, co-author's fix online\n");
  });

  it("[P5.B.3.m] a save based on the current version goes through, a new file is based on none, and a trial course refuses a stale save too", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    const A = await committer(table, store, clientFor(s));
    await editorSave(store, A, "study-guide/ch1.md", "# One v1\n", await opened(store, "study-guide/ch1.md"));
    await editorSave(store, A, "study-guide/ch9.md", "# Nine\n", null);
    expect(head(s, "study-guide/ch9.md")).toBe("# Nine\n");
    expect(await refusal(editorSave(store, A, "study-guide/ch9.md", "# Nine again\n", null))).toBeInstanceOf(
      FileChangedSinceOpenedError,
    );

    const trial = new MemoryPackageStore();
    await trial.createPackage({ ...rec, storage: "sandbox" }, [{ repo: "public", path: "study-guide/ch1.md", content: "# One\n" }]);
    const base = await sha256Hex("# One\n");
    await writeThrough(trial, null, "pkg-1", { summary: "s", changes: [{ repo: "public", path: "study-guide/ch1.md", content: "# A\n", baseHash: base }] });
    const err = await refusal(
      writeThrough(trial, null, "pkg-1", { summary: "s", changes: [{ repo: "public", path: "study-guide/ch1.md", content: "# B\n", baseHash: base }] }),
    );
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(await trial.readFile("pkg-1", "public", "study-guide/ch1.md")).toBe("# A\n");
  });

  it("[P5.B.3.m] every editor save sends the base it opened: hosted study guide and slides, the block editor, the file editor, the collection editor and an AI rewrite", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const ws = join(__dirname, "..", "app", "workspace", "[packageId]");
    const shell = readFileSync(join(ws, "edit", "studio-shell.tsx"), "utf8");
    const pane = readFileSync(join(ws, "edit", "collection-editor-pane.tsx"), "utf8");
    const hosted = readFileSync(join(ws, "hosted-actions.ts"), "utf8");
    expect(shell.match(/baseHash: baseRef\.current,/g)).toHaveLength(2); // both hosted editors
    expect(shell).toContain("baseRef.current,\n      );"); // the block editor's saveStudyGuideAction
    expect(shell).toContain("saveFileAction(packageId, file.path, file.repo, text, baseRef.current)");
    expect(shell).toContain("saveFileAction(packageId, path!, repo!, proposed, baseRef?.current)");
    expect(pane).toContain("saveCollectionFileAction(packageId, space, path, content, await base.current!)");
    // The editing surfaces report the version they were generated from.
    expect(hosted.match(/return \{ ok: true, editable: true, html, theme, contentHash \}/g)).toHaveLength(2);
    expect(hosted.match(/withBase\(write, payload\.baseHash\)/g)).toHaveLength(2);
  });
});

describe("a branch that moved under a commit (loop r4, P5.B.3.n)", () => {
  it("[P5.B.3.n] two tabs saving different files truly at once: the later one is rebuilt on the new head and lands (R4-1)", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    const B = await committer(table, store, clientFor(s));
    // Just before B moves the branch, A's whole save lands.
    s.beforePatch = async () => {
      const A = await committer(table, store, clientFor(s));
      await save(store, A, "study-guide/ch1.md", "# One A\n");
      mocks.client = clientFor(s);
    };
    await save(store, B, "study-guide/ch2.md", "# Two B\n");
    expect(head(s, "study-guide/ch1.md")).toBe("# One A\n");
    expect(head(s, "study-guide/ch2.md")).toBe("# Two B\n");
  });

  it("[P5.B.3.n] the rebuild runs the outside-change guard again: the same file is refused, nothing written over the other tab", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    const base = await opened(store, "study-guide/ch1.md");
    const B = await committer(table, store, clientFor(s));
    s.beforePatch = async () => {
      const A = await committer(table, store, clientFor(s));
      await editorSave(store, A, "study-guide/ch1.md", "# One A\n", base);
    };
    const err = await refusal(editorSave(store, B, "study-guide/ch1.md", "# One B\n", base));
    expect(err).toBeInstanceOf(FileChangedSinceOpenedError);
    expect(head(s, "study-guide/ch1.md")).toBe("# One A\n");
  });
});

describe("the r3 clauses, asserted (loop r4, P5.B.3.g)", () => {
  it("[P5.B.3.g] a save refused only because of Alembic's own commit is retried exactly once after one reconcile", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0", { failUpdates: 2 });
    const A = await committer(table, store, clientFor(s));
    await save(store, A, "study-guide/ch1.md", "# v1\n"); // pointer stuck at c0
    const count = s.trees.size;
    await save(store, A, "study-guide/ch1.md", "# v2\n");
    const builds = s.trees.size - count;
    expect(mocks.reconciles).toBe(1);
    expect(builds).toBe(1); // one commit built: the retry (the refused attempt built nothing)
    expect(head(s, "study-guide/ch1.md")).toBe("# v2\n");
  });

  it("[P5.B.3.g] refused again after reconcile (the course changed again meanwhile): plain refusal, nothing written", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0", { failUpdates: 2 });
    const A = await committer(table, store, clientFor(s));
    await save(store, A, "study-guide/ch1.md", "# v1\n");
    const { reconcilePackage } = await import("./github");
    const real = reconcilePackage as unknown as (...a: unknown[]) => Promise<unknown>;
    // The outside change lands right after the reconcile, before the retry.
    const spy = vi.spyOn(await import("./github"), "reconcilePackage").mockImplementationOnce(async (...a: unknown[]) => {
      const out = await real(...a);
      foreign(s, { "study-guide/ch1.md": "# v1, edited online\n" });
      return out as never;
    });
    const writes = s.writes;
    const err = await refusal(save(store, A, "study-guide/ch1.md", "# v2\n"));
    spy.mockRestore();
    expect(err).toBeInstanceOf(CommitFailedError);
    expect(err!.message).toBe(CHANGED_OUTSIDE);
    expect(s.writes).toBe(writes);
    expect(head(s, "study-guide/ch1.md")).toBe("# v1, edited online\n");
  });

  it("[P5.B.3.g] when bringing outside changes in fails, the save is refused plainly and nothing is written", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch1.md": "# One, online\n" });
    const A = await committer(table, store, clientFor(s));
    mocks.failReconcile = true;
    const writes = s.writes;
    const err = await refusal(save(store, A, "study-guide/ch1.md", "# One, mine\n"));
    expect(err).toBeInstanceOf(CommitFailedError);
    expect(err!.message).toBe(CHANGED_OUTSIDE);
    expect(mocks.reconciles).toBe(1);
    expect(s.writes).toBe(writes);
    expect(head(s, "study-guide/ch1.md")).toBe("# One, online\n");
  });

  it("[P5.B.3.g] a real outside edit to the saved file is brought in and named, never retried", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch1.md": "# One, online\n" });
    const A = await committer(table, store, clientFor(s));
    const count = s.trees.size;
    const err = await refusal(save(store, A, "study-guide/ch1.md", "# One, mine\n"));
    expect(err!.message).toBe(CHANGED_OUTSIDE_BROUGHT_IN);
    expect(s.trees.size).toBe(count);
  });
});

describe("a comparison that cannot be trusted (loop r3 P5.B.3.j, bound in r4)", () => {
  it("[P5.B.3.j] a \"diverged\" comparison: the save guard refuses as unverifiable, writing nothing, and reconcile brings the change in by comparing trees", async () => {
    const { s, store } = await course();
    const table = packagesTable("c0");
    foreign(s, { "study-guide/ch2.md": "# Two, online\n" });
    s.compare = "diverged";
    // The guard alone (no reconcile): refused as unverifiable, nothing written.
    const { commitFiles, RemoteChangedError } = await import("@alembic/github-bridge");
    const writes = s.writes;
    const err = await commitFiles(
      clientFor(s),
      { owner: "prof", repo: "thermo" },
      { repo: "public", summary: "s", changes: [{ path: "study-guide/ch1.md", content: "# x\n" }] },
      "main",
      { unchangedSince: "c0" },
    ).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteChangedError);
    expect((err as InstanceType<typeof RemoteChangedError>).reason).toBe("unverifiable");
    expect(s.writes).toBe(writes);
    // Reconcile falls back to the tree comparison and brings the change in.
    const r = await reconcileNow(table, store, s);
    expect(r?.status).toBe("absorbed");
    if (r?.status === "absorbed") expect(r.changedPaths).toEqual(["study-guide/ch2.md"]);
    expect(await store.readFile("pkg-1", "public", "study-guide/ch2.md")).toBe("# Two, online\n");
  });
});


describe("stored form (loop r4, P5.B.3.k)", () => {
  it("[P5.B.3.k] text keeps a leading byte-order mark, so it re-encodes to the same bytes; binaries are base64 by name", async () => {
    const { storedForm } = await import("./repo-reader");
    const bom = Buffer.from("﻿# One\n", "utf8");
    expect(Buffer.from(storedForm("study-guide/ch1.md", bom), "utf8").equals(bom)).toBe(true);
    expect(storedForm("assets/fig.png", Buffer.from(PNG, "base64"))).toBe(PNG);
  });
});
