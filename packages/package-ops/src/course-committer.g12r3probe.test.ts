/**
 * G1+G2 round-3 adversary probes for commit 035af7e (course committer).
 * Each test asserts what the spec requires; a failing test is a finding.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Role } from "@alembic/package-contract";
import { drainCourse, HeadMoved, processRow, type QueueRow, type QueueStore, type RowStatus, type WorkingRepo } from "./course-committer";

const h = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const sg = (...s: string[]) => "# T\n\n" + s.map((x, i) => `## S${i}\n\n${x}\n\n`).join("");
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

class FakeRepo implements WorkingRepo {
  commits: Array<{ sha: string; parent: string | null; files: Map<string, string>; message: string }> = [];
  headSha = "c0";
  /** The next commitChain waits on this between beforeMove and the ref move (slow getRefSha/PATCH). */
  moveGate?: Promise<void>;
  constructor(initial: Record<string, string>) {
    this.commits.push({ sha: "c0", parent: null, files: new Map(Object.entries(initial)), message: "init" });
  }
  private byId(sha: string) {
    return this.commits.find((c) => c.sha === sha)!;
  }
  async head() {
    return this.headSha;
  }
  async readFile(ref: string, path: string) {
    return this.byId(ref).files.get(path) ?? null;
  }
  async recentCommits(limit: number) {
    const out = [];
    let c: string | null = this.headSha;
    while (c && out.length < limit) {
      const x = this.byId(c);
      out.push({ sha: x.sha, message: x.message });
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
  async commitChain(input: { expectedHead: string; steps: Array<{ message: string; files: Array<{ path: string; content: string | null }> }>; beforeMove?: (shas: string[]) => Promise<void>; signal?: AbortSignal }) {
    let parent = input.expectedHead;
    let files = new Map(this.byId(parent).files);
    const staged: Array<{ sha: string; parent: string; files: Map<string, string>; message: string }> = [];
    for (const step of input.steps) {
      files = new Map(files);
      for (const f of step.files) f.content === null ? files.delete(f.path) : files.set(f.path, f.content);
      staged.push({ sha: `s${Math.random().toString(36).slice(2)}`, parent, files, message: step.message });
      parent = staged.at(-1)!.sha;
    }
    await input.beforeMove?.(staged.map((x) => x.sha));
    if (this.moveGate) {
      const g = this.moveGate;
      this.moveGate = undefined;
      await g; // getRefSha + PATCH in flight
    }
    // Mirrors the fixed client: the attempt's signal cancels the ref update (G2 r3 fix).
    if (input.signal?.aborted) throw new Error("commit attempt aborted before the ref move");
    if (this.headSha !== input.expectedHead) throw new HeadMoved();
    this.commits.push(...staged);
    this.headSha = parent;
    return { commitShas: staged.map((s) => s.sha), head: parent };
  }
  file(path: string) {
    return this.byId(this.headSha).files.get(path) ?? null;
  }
}

/** Mirrors migration 0037: claim = processing at this attempt; planned_shas; last_retry_at as a seq mark. */
class MemQueue implements QueueStore {
  rows: Array<QueueRow & { status: string; seq: number; result?: unknown; plannedShas: string[] }> = [];
  roles = new Map<string, Role>();
  versions = new Map<string, string>();
  seq = 0;
  retryMark = 0; // course_committer.last_retry_at: rows created before it are afterOutage
  add(row: Omit<QueueRow, "attempts">) {
    this.rows.push({ ...row, attempts: 0, status: "queued", seq: ++this.seq, plannedShas: [] });
  }
  remember(...texts: string[]) {
    for (const t of texts) this.versions.set(h(t), t);
  }
  async acquire() {
    return "1";
  }
  async next(p: string) {
    const r = this.rows.filter((x) => x.packageId === p && ["queued", "processing", "retry"].includes(x.status)).sort((a, b) => a.seq - b.seq)[0];
    if (!r) return undefined;
    r.status = "processing";
    r.attempts++;
    return { ...r, plannedShas: [...r.plannedShas], afterOutage: r.seq <= this.retryMark };
  }
  async finish(i: { id: string; status: RowStatus; result?: unknown }) {
    const r = this.rows.find((x) => x.id === i.id)!;
    r.status = i.status;
    r.result = i.result;
    // Mirrors the fixed 0037: the mark also moves when a retried row finally ends.
    if (i.status === "retry" || r.attempts > 1) this.retryMark = this.seq;
  }
  async claimCurrent(id: string, _h: string, _f: string, attempts: number) {
    const r = this.rows.find((x) => x.id === id)!;
    return r.status === "processing" && r.attempts === attempts;
  }
  async recordPlanned(id: string, holder: string, fence: string, attempts: number, shas: string[]) {
    if (!(await this.claimCurrent(id, holder, fence, attempts))) throw new Error("claim lost");
    this.rows.find((x) => x.id === id)!.plannedShas.push(...shas);
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

describe("G1+G2 round-3 probes (committer, 035af7e)", () => {
  it("MEDIUM: the claim check passes, the deadline fires during getRefSha/PATCH, the row is refused (member removed) — and the ref still moves", async () => {
    const repo = new FakeRepo({ [PATH]: base });
    const q = new MemQueue();
    q.roles.set("co", "co-author");
    q.remember(base);
    q.add({ id: "r1", packageId: P, kind: "sync", actorId: "co", invokerId: null, payload: { files: [{ path: PATH, baseVersion: h(base), text: sg("mine", "two", "three") }] } });
    let release!: () => void;
    repo.moveGate = new Promise<void>((r) => (release = r)); // the GitHub ref calls hang after beforeMove passed
    await drainCourse(P, "w", q, repo, 50, { deadlineMs: 30 });
    expect(q.row("r1").status).toBe("retry");
    q.roles.delete("co"); // the owner removes the co-author
    await drainCourse(P, "w", q, repo, 50, { deadlineMs: 30 });
    expect(q.row("r1").status).toBe("refused");
    release(); // attempt 1's PATCH finally goes through: head is still c0, so it fast-forwards
    await tick();
    // queue §2.5 + the 035af7e claim: "a superseded attempt can never commit after its row moved on".
    expect(repo.file(PATH)).toBe(base);
  });

  it("MEDIUM: a sync queued during an outage, after the blocking row's last retry, still puts the typist on top", async () => {
    const repo = new FakeRepo({ [PATH]: base, "README.md": "r" });
    repo.push({ [PATH]: sg("ONE", "two", "three") }); // someone else changed S0
    const q = new MemQueue();
    q.roles.set("owner", "owner");
    q.roles.set("co", "co-author");
    q.remember(base);
    // r1 hit the outage and is waiting in 'retry' (backoff up to 15 min).
    q.add({ id: "r1", packageId: P, kind: "sync", actorId: "owner", invokerId: null, payload: { files: [{ path: "README.md", baseVersion: h("r"), text: "r2" }] } });
    await q.next(P);
    await q.finish({ id: "r1", status: "retry" }); // last_retry_at = now
    // During the outage (client shows "waiting for GitHub"), the co-author's editor autosyncs, then closes.
    q.add({ id: "r2", packageId: P, kind: "sync", actorId: "co", invokerId: null, payload: { files: [{ path: PATH, baseVersion: h(base), text: sg("uno", "two", "three") }], fromOpenEditor: true } });
    // GitHub is back 15 min later: r1 lands, then r2 (its first attempt).
    await drainCourse(P, "w", q, repo);
    expect(q.row("r2").status).toBe("done");
    // write-path §5/§7: any row processed after an outage keeps current on top (editor may be long gone).
    expect(repo.file(PATH)).toBe(sg("ONE", "two", "three"));
  });

  it("LOW: a summary with a newline forges an Alembic-File line that recovery trusts over the real one", async () => {
    const repo = new FakeRepo({ [PATH]: base });
    repo.push({ [PATH]: sg("ONE", "two", "three") });
    const q = new MemQueue();
    q.roles.set("co", "co-author");
    q.remember(base);
    q.add({
      id: "r1", packageId: P, kind: "sync", actorId: "co", invokerId: null,
      payload: { files: [{ path: PATH, baseVersion: h(base), text: sg("uno", "two", "three") }], summary: `Add chapter x\nAlembic-File: landed ${PATH}` },
    });
    const row = (await q.next(P))!;
    const first = await processRow(row, q, repo, { claim: { holder: "w", fence: "1" } });
    expect(first.status).toBe("done");
    expect((first as { result: { files: Array<{ outcome: string }> } }).result.files[0]!.outcome).toBe("both-changed");
    // worker dies before finish(); the row is reclaimed and recovered from the trailers
    const again = (await q.next(P))!;
    const rec = await processRow(again, q, repo, { claim: { holder: "w", fence: "1" } });
    expect((rec as { result: { files: Array<{ path: string; outcome: string }> } }).result.files).toEqual([{ path: PATH, outcome: "both-changed", reason: "same-block" }]);
  });

  it("LOW: a root path with a space is mis-parsed on recovery (first word read as the reason)", async () => {
    const repo = new FakeRepo({ "README.md": "r" }); // a new root file: outcome landed, no reason
    const q = new MemQueue();
    q.add({ id: "o1", packageId: P, kind: "outside", actorId: null, invokerId: null, payload: { files: [{ path: "old notes.md", baseVersion: null, text: "b" }] } });
    const row = (await q.next(P))!;
    const first = await processRow(row, q, repo, { claim: { holder: "w", fence: "1" } });
    expect(first.status).toBe("done");
    const again = (await q.next(P))!;
    const rec = await processRow(again, q, repo, { claim: { holder: "w", fence: "1" } });
    expect((rec as { result: { files: Array<{ path: string }> } }).result.files.map((f) => f.path)).toEqual(["old notes.md"]);
  });
});
