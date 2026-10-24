/**
 * A simulated GitHub repository with real file contents and blob ids, for the
 * committer / reconcile scenario tests (loop r3–r5). Extracted from
 * committer.r4.test.ts in loop r5 so committer.r5.test.ts runs over the same
 * simulator. Test-only (not imported by app code).
 *
 * `clientFor` routes `/repos/prof/<name>` to `repos[name]` when given (a
 * course with a private repository), else to `s`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { GitHubClient, gitBlobSha, type FetchLike, type FetchResponse } from "@alembic/github-bridge";
import { parseManifest, sha256Hex } from "@alembic/package-contract";
import { MemoryPackageStore, writeThrough, type Committer, type PackageRecord, type PackageStore } from "@alembic/package-ops";


export type Snapshot = Map<string, string>;
export type CompareMode = "ok" | "fails" | "too-many" | "diverged";

export function repoState(initial: Record<string, string>) {
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
export type RepoState = ReturnType<typeof repoState>;

export function isAncestor(s: RepoState, base: string, tip: string): boolean {
  for (let at: string | null = tip; at; at = s.commits.get(at)?.parent ?? null) if (at === base) return true;
  return false;
}

/** A file's bytes: "B64:…" is a binary written as base64, anything else UTF-8. */
export function bytesOf(c: string): Buffer {
  return c.startsWith("B64:") ? Buffer.from(c.slice(4), "base64") : Buffer.from(c, "utf8");
}

/** A change made directly on the hosting site, outside Alembic. */
export function foreign(s: RepoState, edits: Record<string, string | null>): string {
  const files = new Map(s.commits.get(s.head)!.files);
  for (const [p, c] of Object.entries(edits)) (c === null ? files.delete(p) : files.set(p, c));
  const sha = `f${++s.n}`;
  s.commits.set(sha, { parent: s.head, files });
  s.head = sha;
  return sha;
}

/** A client over the shared repo state; `gate` delays this client's first request. */
export function clientFor(home: RepoState, gate?: Promise<void>, repos?: Record<string, RepoState>) {
  let gated = !!gate;
  const ok = (json: unknown): FetchResponse => ({ ok: true, status: 200, json: async () => json, text: async () => "" });
  const nf: FetchResponse = { ok: false, status: 404, json: async () => ({}), text: async () => "Not Found" };
  const snapshotIn = (s: RepoState, ref: string): Snapshot | undefined =>
    s.commits.get(ref)?.files ?? s.trees.get(ref) ?? s.commits.get(ref.replace(/^tree-/, ""))?.files;
  const fetchImpl: FetchLike = async (url, init) => {
    if (gated) {
      gated = false;
      await gate;
    }
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const name = /^https:\/\/api\.github\.com\/repos\/prof\/([^/]+)/.exec(url)?.[1] ?? "thermo";
    const s = repos?.[name] ?? home;
    const path = url.replace(/^https:\/\/api\.github\.com\/repos\/prof\/[^/]+/, "");
    const snapshotOf = (ref: string) => snapshotIn(s, ref);
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

export function packagesTable(initial: string | null, opts: { failUpdates?: number } = {}) {
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

export const m = parseManifest({
  schemaVersion: 2,
  packageId: "pkg-1",
  title: "T",
  license: "CC-BY-4.0",
  createdAt: "2026-08-28T00:00:00.000Z",
  publicRepo: { owner: "prof", name: "thermo" },
});
export const rec: PackageRecord = {
  packageId: "pkg-1",
  ownerId: "u",
  title: "T",
  storage: "github",
  manifest: m,
  repos: { public: { owner: "prof", name: "thermo" }, private: null },
};
export const INITIAL = { "study-guide/ch1.md": "# One\n", "study-guide/ch2.md": "# Two\n" };

export async function course(initial: Record<string, string> = INITIAL) {
  const s = repoState(initial);
  const store = new MemoryPackageStore();
  await store.createPackage(
    rec,
    Object.entries(initial).map(([path, content]) => ({ repo: "public" as const, path, content })),
  );
  return { s, store };
}

/** A save through the one write path: commit first, then project. */
export const save = (store: PackageStore, c: Committer, path: string, content: string) =>
  writeThrough(store, c, "pkg-1", { summary: "Save", changes: [{ repo: "public", path, content }] });

/** An editor's save: based on the stored version it opened (loop r4, P5.B.3.m). */
export const editorSave = (store: PackageStore, c: Committer, path: string, content: string, baseHash: string | null) =>
  writeThrough(store, c, "pkg-1", { summary: "Save", changes: [{ repo: "public", path, content, baseHash }] });

/** What an editor opening `path` now is based on. */
export async function opened(store: PackageStore, path: string): Promise<string | null> {
  const c = await store.readFile("pkg-1", "public", path);
  return c === null ? null : sha256Hex(c);
}

export const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error);
export const NO_DEV_WORDS = /\b(git|github|commit|branch|repo|repository|sha|merge|push)\b/i;
export const head = (s: RepoState, p: string) => s.commits.get(s.head)!.files.get(p);
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80, 0x90]).toString("base64");
/** A block-id corruption the reconcile holds back (duplicate ids). */
export const BROKEN = "# Two\n\n## A {{attrs[#blk-aaaa1111]}}\n\nx\n\n## B {{attrs[#blk-aaaa1111]}}\n\ny\n";
