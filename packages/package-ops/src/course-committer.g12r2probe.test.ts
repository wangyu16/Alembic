/**
 * G1+G2 round-2 adversary probes for the write path (course committer).
 * Each test asserts what the spec requires; a failing test is a finding.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Role } from "@alembic/package-contract";
import { drainCourse, HeadMoved, processRow, RepoUnavailableError, type QueueRow, type QueueStore, type RowStatus, type WorkingRepo } from "./course-committer";

const h = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const sg = (...s: string[]) => "# T\n\n" + s.map((x, i) => `## S${i}\n\n${x}\n\n`).join("");
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

class FakeRepo implements WorkingRepo {
  commits: Array<{ sha: string; parent: string | null; files: Map<string, string>; message: string; alembic?: boolean }> = [];
  headSha = "c0";
  /** Next readFile waits on this (a slow GitHub call). */
  gate?: Promise<void>;
  outage = false;
  constructor(initial: Record<string, string>) {
    this.commits.push({ sha: "c0", parent: null, files: new Map(Object.entries(initial)), message: "init" });
  }
  private byId(sha: string) {
    return this.commits.find((c) => c.sha === sha)!;
  }
  async head() {
    if (this.outage) throw new RepoUnavailableError("outage", "GitHub is down");
    return this.headSha;
  }
  async readFile(ref: string, path: string) {
    if (this.gate) {
      const g = this.gate;
      this.gate = undefined;
      await g;
    }
    return this.byId(ref).files.get(path) ?? null;
  }
  async recentCommits(limit: number) {
    const out = [];
    let c: string | null = this.headSha;
    while (c && out.length < limit) {
      const x = this.byId(c);
      out.push({ sha: x.sha, message: x.message, byAlembic: x.alembic === true });
      c = x.parent;
    }
    return out;
  }
  push(files: Record<string, string>, message = "outside") {
    const next = new Map(this.byId(this.headSha).files);
    for (const [p, t] of Object.entries(files)) next.set(p, t);
    const sha = `c${this.commits.length}`;
    this.commits.push({ sha, parent: this.headSha, files: next, message });
    this.headSha = sha;
  }
  async commitChain(input: { expectedHead: string; steps: Array<{ message: string; files: Array<{ path: string; content: string | null }> }>; beforeMove?: (shas: string[]) => Promise<void> }) {
    let parent = input.expectedHead;
    let files = new Map(this.byId(parent).files);
    const staged: Array<{ sha: string; parent: string; files: Map<string, string>; message: string; alembic?: boolean }> = [];
    for (const step of input.steps) {
      files = new Map(files);
      for (const f of step.files) f.content === null ? files.delete(f.path) : files.set(f.path, f.content);
      staged.push({ sha: `s${Math.random().toString(36).slice(2)}`, parent, files, message: step.message, alembic: true });
      parent = staged.at(-1)!.sha;
    }
    await input.beforeMove?.(staged.map((x) => x.sha));
    if (this.headSha !== input.expectedHead) throw new HeadMoved();
    this.commits.push(...staged);
    this.headSha = parent;
    return { commitShas: staged.map((s) => s.sha), head: parent };
  }
  file(path: string) {
    return this.byId(this.headSha).files.get(path) ?? null;
  }
  commitsFor(rowId: string) {
    return this.commits.filter((c) => c.message.split("\n").some((l) => l.trim() === `Alembic-Write: ${rowId}`));
  }
}

class MemQueue implements QueueStore {
  rows: Array<QueueRow & { status: string; seq: number; result?: unknown }> = [];
  roles = new Map<string, Role>();
  versions = new Map<string, string>();
  seq = 0;
  add(row: Omit<QueueRow, "attempts">) {
    this.rows.push({ ...row, attempts: 0, status: "queued", seq: ++this.seq });
  }
  remember(...texts: string[]) {
    for (const t of texts) this.versions.set(h(t), t);
  }
  async acquire() {
    return "1";
  }
  retryMark = 0; // like course_committer.last_retry_at: rows created before the last retry waited through it
  async next(p: string) {
    const r = this.rows.filter((x) => x.packageId === p && ["queued", "processing", "retry"].includes(x.status)).sort((a, b) => a.seq - b.seq)[0];
    if (!r) return undefined;
    r.status = "processing";
    r.attempts++;
    return { ...r, afterOutage: r.seq <= this.retryMark };
  }
  async finish(i: { id: string; status: RowStatus; result?: unknown }) {
    const r = this.rows.find((x) => x.id === i.id)!;
    r.status = i.status;
    r.result = i.result;
    if (i.status === "retry") this.retryMark = this.seq;
  }
  async roleOf(_p: string, u: string) {
    return this.roles.get(u) ?? "none";
  }
  async baseText(_p: string, _path: string, v: string) {
    return this.versions.get(v);
  }
  row(id: string) {
    return this.rows.find((r) => r.id === id)!;
  }
}

const P = "pkg";
const PATH = "study-guide/g.md";
const base = sg("one", "two", "three");

describe("G1+G2 round-2 probes (committer)", () => {
  it("HIGH: a row past its deadline keeps running; after the row is refused (member removed) the zombie still commits it", async () => {
    const repo = new FakeRepo({ [PATH]: base });
    const q = new MemQueue();
    q.roles.set("co", "co-author");
    q.remember(base);
    q.add({ id: "r1", packageId: P, kind: "sync", actorId: "co", invokerId: null, payload: { files: [{ path: PATH, baseVersion: h(base), text: sg("mine", "two", "three") }] } });
    let release!: () => void;
    repo.gate = new Promise<void>((r) => (release = r)); // a slow GitHub read
    await drainCourse(P, "w", q, repo, 50, { deadlineMs: 30 });
    expect(q.row("r1").status).toBe("retry"); // abandoned at the deadline, attempt counted
    q.roles.delete("co"); // the owner removes the co-author
    await drainCourse(P, "w", q, repo, 50, { deadlineMs: 30 });
    expect(q.row("r1").status).toBe("refused"); // execution-time re-check
    release(); // the first attempt's GitHub call finally returns
    await tick();
    // queue §2.5: removed → refused; nothing of the row may land.
    expect(repo.commitsFor("r1")).toHaveLength(0);
    expect(repo.file(PATH)).toBe(base);
  });

  it("MEDIUM: a recovered row (crash after the ref move / stale holder) loses its per-file outcomes and the kept commit", async () => {
    const repo = new FakeRepo({ [PATH]: base });
    repo.push({ [PATH]: sg("ONE", "two", "three") }); // someone else changed S0
    const q = new MemQueue();
    q.roles.set("co", "co-author");
    q.remember(base);
    const row: QueueRow = {
      id: "r1", packageId: P, kind: "sync", actorId: "co", invokerId: null, attempts: 1,
      payload: { files: [{ path: PATH, baseVersion: h(base), text: sg("uno", "two", "three") }] },
    };
    const first = await processRow(row, q, repo); // lands kept + top; the worker then dies before finish()
    expect(first.status).toBe("done");
    const again = await processRow({ ...row, attempts: 2 }, q, repo); // restart: trailer scan
    expect(again.status).toBe("done");
    const r = (again as { result: { files: Array<{ path: string; outcome: string }>; commits: string[] } }).result;
    // queue §3: "record the result from that commit" — the Both-changed item needs the outcome and the kept commit.
    expect(r.files.find((f) => f.path === PATH)?.outcome).toBe("both-changed");
    expect(r.commits).toHaveLength(2);
  });

  it("LOW: a changeset 'record' path with dot segments skips every path check (records are exempt by prefix only)", async () => {
    const repo = new FakeRepo({ [PATH]: base });
    const q = new MemQueue();
    q.roles.set("owner", "owner");
    const row: QueueRow = {
      id: "c1", packageId: P, kind: "changeset", actorId: null, invokerId: "owner", attempts: 1,
      payload: { files: [{ path: "private/coursewerk/../../.github/workflows/x.yml", baseVersion: null, text: "on: push" }] },
    };
    const r = await processRow(row, q, repo);
    expect(r.status).toBe("refused");
  });

  it("LOW: a sync first processed after an outage (queued behind a retrying row) still puts the typist on top", async () => {
    const repo = new FakeRepo({ [PATH]: base, "README.md": "r" });
    repo.push({ [PATH]: sg("ONE", "two", "three") }); // someone else changed S0
    const q = new MemQueue();
    q.roles.set("owner", "owner");
    q.roles.set("co", "co-author");
    q.remember(base);
    q.add({ id: "r1", packageId: P, kind: "sync", actorId: "owner", invokerId: null, payload: { files: [{ path: "README.md", baseVersion: h("r"), text: "r2" }] } });
    q.add({ id: "r2", packageId: P, kind: "sync", actorId: "co", invokerId: null, payload: { files: [{ path: PATH, baseVersion: h(base), text: sg("uno", "two", "three") }], fromOpenEditor: true } });
    repo.outage = true;
    await drainCourse(P, "w", q, repo); // r1 → retry; r2 waits behind it
    repo.outage = false;
    await drainCourse(P, "w", q, repo); // after the outage: r1 then r2 (r2's first attempt)
    expect(q.row("r2").status).toBe("done");
    // write-path §5: "any row processed after an outage keeps current on top".
    expect(repo.file(PATH)).toBe(sg("ONE", "two", "three"));
  });
});
