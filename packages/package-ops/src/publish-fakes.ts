/**
 * Test doubles for the Publish job (shared by the job tests and the G3
 * probes). Not imported by product code. The public fake stores blobs by
 * their real git blob id, like GitHub, so kept files round-trip by blob.
 */
import { createHash } from "node:crypto";
import { WorkingManifestV3Schema, type Role } from "@alembic/package-contract";
import { classifyBytes, gitBlobSha, type PublicSide, type PublishedRecord, type PublishStore, type TreeEntry, type WorkingSide } from "./publish-job";

export const h = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

export function manifestJson(chs: Array<{ slug: string; mode?: "draft" | "package" }>): string {
  return JSON.stringify(WorkingManifestV3Schema.parse({
    schemaVersion: 3, packageId: "pkg-1", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-27T00:00:00Z",
    privateRepo: { owner: "yu", name: "chem-private" }, chapters: chs.map((c) => ({ slug: c.slug, title: c.slug, mode: c.mode ?? "package" })),
  }));
}

/** A working tree; a file whose content contains a NUL byte is binary (classified by content, like the adapter). */
export function working(files: Record<string, string>, extra: TreeEntry[] = [], truncated = false, unreadable: string[] = []): WorkingSide {
  return {
    async head() { return "W1"; },
    async listTree() { return { entries: [...Object.keys(files).map((p) => ({ path: p, mode: "100644", blobSha: `wb-${p}` })), ...extra], truncated }; },
    async readFile(_s, p) {
      if (unreadable.includes(p) || !(p in files)) return null;
      return classifyBytes(new TextEncoder().encode(files[p]!));
    },
  };
}

export class FakePublic implements PublicSide {
  commits: Array<{ sha: string; message: string; files: Map<string, string> }> = [];
  blobs = new Map<string, string>();
  headSha: string | null = null;
  moveOnce = false;
  async head() { return this.headSha; }
  async create() { this.commits.push({ sha: "p0", message: "init", files: new Map() }); this.headSha = "p0"; return "p0"; }
  private at(sha: string) { return this.commits.find((c) => c.sha === sha)!; }
  async listTree(sha: string) {
    const entries: TreeEntry[] = [];
    for (const [p, t] of this.at(sha).files) entries.push({ path: p, mode: "100644", blobSha: await gitBlobSha(t) });
    return { entries, truncated: false };
  }
  async readText(sha: string, p: string) { return this.at(sha).files.get(p) ?? null; }
  async recentCommits() { return [...this.commits].reverse().map((c) => ({ sha: c.sha, message: c.message })); }
  async changedPaths(from: string, to: string) {
    const a = this.at(from).files, b = this.at(to).files;
    return [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p));
  }
  async commit(i: { expectedHead: string; message: string; files: Array<{ path: string; text?: string; blobSha?: string; delete?: true }> }) {
    if (this.moveOnce) {
      this.moveOnce = false;
      const e = new Error("head moved"); e.name = "HeadMovedError"; throw e;
    }
    if (i.expectedHead !== this.headSha) { const e = new Error("head moved"); e.name = "HeadMovedError"; throw e; }
    const next = new Map(this.at(this.headSha!).files);
    for (const f of i.files) {
      if (f.delete) next.delete(f.path);
      else if (f.text !== undefined) { next.set(f.path, f.text); this.blobs.set(await gitBlobSha(f.text), f.text); }
      else next.set(f.path, this.blobs.get(f.blobSha!) ?? `blob:${f.blobSha}`);
    }
    const sha = `p${this.commits.length}`;
    this.commits.push({ sha, message: i.message, files: next });
    this.headSha = sha;
    return sha;
  }
  async push(path: string, text: string) {
    const next = new Map(this.at(this.headSha!).files); next.set(path, text); this.blobs.set(await gitBlobSha(text), text);
    const sha = `p${this.commits.length}`; this.commits.push({ sha, message: "edited on GitHub", files: next }); this.headSha = sha;
  }
  file(p: string) { return this.headSha ? this.at(this.headSha).files.get(p) : undefined; }
}

/** Mirrors migration 0042: records carry blob ids and versions only (no text). */
export class FakeStore implements PublishStore {
  ack: string | null = null;
  runs = new Map<string, { status: string; intended: PublishedRecord[]; publicSha?: string }>();
  files: PublishedRecord[] = [];
  drift: string[][] = [];
  async acknowledged() { return this.ack; }
  async acknowledge(_p: string, sha: string) { this.ack = sha; }
  async anyCommittedRun() { return [...this.runs.values()].some((r) => r.status === "committed"); }
  async pendingRun(_p: string, id: string) { const r = this.runs.get(id); return r && r.status === "pending" ? { id, intendedFiles: r.intended } : null; }
  async insertPendingRun(r: { id: string; intendedFiles: PublishedRecord[] }) { this.runs.set(r.id, { status: "pending", intended: r.intendedFiles }); }
  async markCommitted(id: string, sha: string, files: PublishedRecord[]) {
    for (const f of files) if (!f.blobSha) throw new Error(`published_files.blob_sha is NOT NULL (${f.path})`);
    this.runs.set(id, { status: "committed", intended: files, publicSha: sha });
    this.files = files.map((f) => ({ path: f.path, unit: f.unit, blobSha: f.blobSha, version: f.version, sourceBlob: f.sourceBlob ?? null }));
  }
  async publishedFiles() { return this.files; }
  async bringInDrift(_p: string, _s: string, paths: string[]) { this.drift.push(paths); return "done" as const; }
  isCommitted?: (packageId: string, runId: string, publicSha: string) => Promise<boolean>;
  markStopped?: (runId: string, reason: string) => Promise<void>;
}
