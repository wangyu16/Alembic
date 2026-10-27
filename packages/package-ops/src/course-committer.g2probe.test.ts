/**
 * G2 adversary probes for the write path (course committer + version rule).
 * Each test asserts the behaviour the spec requires; a failure demonstrates
 * a finding.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Role } from "@alembic/package-contract";
import { HeadMoved, processRow, type QueueRow, type QueueStore, type RowStatus, type WorkingRepo, drainCourse } from "./course-committer";
import { decideFile } from "./version-rule";

const h = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const sg = (...s: string[]) => "# T\n\n" + s.map((x, i) => `## S${i}\n\n${x}\n\n`).join("");

class FakeRepo implements WorkingRepo {
  commits: Array<{ sha: string; parent: string | null; files: Map<string, string>; message: string; alembic?: boolean }> = [];
  refMoves = 0;
  beforeMove?: () => Promise<void> | void;
  headSha = "c0";
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
  async commitChain(input: { expectedHead: string; steps: Array<{ message: string; files: Array<{ path: string; content: string | null }> }> }) {
    let parent = input.expectedHead;
    let files = new Map(this.byId(parent).files);
    const staged: { sha: string; parent: string; files: Map<string, string>; message: string; alembic?: boolean }[] = [];
    for (const step of input.steps) {
      files = new Map(files);
      for (const f of step.files) f.content === null ? files.delete(f.path) : files.set(f.path, f.content);
      staged.push({ sha: `s${Math.random().toString(36).slice(2)}`, parent, files, message: step.message, alembic: true });
      parent = staged.at(-1)!.sha;
    }
    if (this.beforeMove) {
      const b = this.beforeMove;
      this.beforeMove = undefined;
      await b();
    }
    if (this.headSha !== input.expectedHead) throw new HeadMoved();
    this.commits.push(...staged);
    this.headSha = parent;
    this.refMoves++;
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
  async next(p: string) {
    const r = this.rows.filter((x) => x.packageId === p && ["queued", "processing", "retry"].includes(x.status)).sort((a, b) => a.seq - b.seq)[0];
    if (!r) return undefined;
    r.status = "processing";
    r.attempts++;
    return { ...r };
  }
  async finish(i: { id: string; status: RowStatus; result?: unknown }) {
    const r = this.rows.find((x) => x.id === i.id)!;
    r.status = i.status;
    r.result = i.result;
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

describe("G2 probes", () => {
  it("HIGH: stale holder + takeover — the re-decide loop commits a row a second time (no trailer re-scan before the CAS)", async () => {
    const repo = new FakeRepo({ [PATH]: base });
    repo.push({ [PATH]: sg("ONE", "two", "three") }); // someone else changed S0
    const q = new MemQueue();
    q.roles.set("co", "co-author");
    q.remember(base);
    // Replace (not from an open editor): both-changed, current stays on top → kept + restore chain.
    const row: QueueRow = {
      id: "r1", packageId: P, kind: "sync", actorId: "co", invokerId: null, attempts: 1,
      payload: { files: [{ path: PATH, baseVersion: h(base), text: sg("uno", "two", "three") }], fromOpenEditor: false },
    };
    // Holder A decides and is about to move the ref; its lease expires; holder B takes the row over and lands it.
    repo.beforeMove = async () => {
      const b = await processRow({ ...row, attempts: 2 }, q, repo);
      expect(b.status).toBe("done");
    };
    const a = await processRow(row, q, repo);
    expect(a.status).toBe("done");
    // A sees HeadMoved, re-decides against B's head and commits the same row again.
    expect(repo.commitsFor("r1")).toHaveLength(2); // one kept + one top, once
  });

  it("MEDIUM: an identical change on both sides is a false conflict; a co-author's combined edit falls off the top", async () => {
    // During an outage X's client keeps base b0 (no result yet): r1 X edits S0, r2 Y edits S2 (combined),
    // r3 X's next autosync: S0 as in r1, plus S1.
    const repo = new FakeRepo({ [PATH]: base });
    const q = new MemQueue();
    q.roles.set("x", "owner");
    q.roles.set("y", "co-author");
    q.remember(base);
    const s = (id: string, actor: string, text: string): Omit<QueueRow, "attempts"> => ({
      id, packageId: P, kind: "sync", actorId: actor, invokerId: null,
      payload: { files: [{ path: PATH, baseVersion: h(base), text }], fromOpenEditor: true },
    });
    q.add(s("r1", "x", sg("ONE", "two", "three")));
    q.add(s("r2", "y", sg("one", "two", "THREE")));
    q.add(s("r3", "x", sg("ONE", "TWO", "three")));
    await drainCourse(P, "w", q, repo);
    expect((q.row("r3").result as { files: Array<{ outcome: string }> }).files[0]!.outcome).toBe("combined");
    expect(repo.file(PATH)).toBe(sg("ONE", "TWO", "THREE"));
  });

  it("MEDIUM: decideFile — both sides made the same block edit (plus a disjoint one) → should combine", async () => {
    const d = await decideFile({
      path: PATH, kind: "study-guide", baseVersion: h(base), baseText: base,
      currentText: sg("ONE", "two", "three"), incomingText: sg("ONE", "two", "THREE"), fromOpenEditor: false,
    });
    expect(d.outcome).toBe("combined");
  });

  it("MEDIUM: a harness changeset carrying records is refused outright (spec: records commit when content landed)", async () => {
    const repo = new FakeRepo({ [PATH]: base });
    const q = new MemQueue();
    q.roles.set("owner", "owner");
    q.remember(base);
    q.add({
      id: "c1", packageId: P, kind: "changeset", actorId: null, invokerId: "owner",
      payload: { files: [
        { path: PATH, baseVersion: h(base), text: sg("agent", "two", "three") },
        { path: "private/coursewerk/runs/r1.json", baseVersion: null, text: "{}" },
      ] },
    });
    await drainCourse(P, "w", q, repo);
    expect(q.row("c1").status).toBe("done");
    expect(repo.file("private/coursewerk/runs/r1.json")).toBe("{}");
  });

  it("MEDIUM: a system undo row restoring private/coursewerk/ (Door C, queue §4) is refused", async () => {
    const repo = new FakeRepo({ "private/coursewerk/runs/r1.json": "{}" });
    repo.push({ "private/coursewerk/runs/r1.json": "{\"forged\":true}" });
    const q = new MemQueue();
    q.add({
      id: "u1", packageId: P, kind: "system", actorId: null, invokerId: null,
      payload: { files: [{ path: "private/coursewerk/runs/r1.json", baseVersion: h("{\"forged\":true}"), text: "{}" }] },
    });
    await drainCourse(P, "w", q, repo);
    expect(q.row("u1").status).toBe("done");
    expect(repo.file("private/coursewerk/runs/r1.json")).toBe("{}");
  });

  it("MEDIUM: a pushed commit carrying another row's trailer marks that row done with nothing committed", async () => {
    const repo = new FakeRepo({ [PATH]: base });
    const q = new MemQueue();
    q.roles.set("owner", "owner");
    q.remember(base);
    // A member can SELECT the course's queue rows (ids are visible) and push on GitHub (Door C).
    repo.push({ "README.md": "hi" }, "tweak\n\nAlembic-Write: r1");
    q.add({ id: "r1", packageId: P, kind: "sync", actorId: "owner", invokerId: null, payload: { files: [{ path: PATH, baseVersion: h(base), text: sg("mine", "two", "three") }] } });
    await drainCourse(P, "w", q, repo);
    expect(q.row("r1").status).toBe("done");
    expect(repo.file(PATH)).toBe(sg("mine", "two", "three"));
  });

  it("LOW: after an outage (row retried) an open-editor sync still puts incoming on top (spec §7: ignored at drain)", async () => {
    const repo = new FakeRepo({ [PATH]: sg("ONE", "two", "three") });
    const q = new MemQueue();
    q.roles.set("co", "co-author");
    q.remember(base);
    const row: QueueRow = {
      id: "r1", packageId: P, kind: "sync", actorId: "co", invokerId: null, attempts: 6,
      payload: { files: [{ path: PATH, baseVersion: h(base), text: sg("uno", "two", "three") }], fromOpenEditor: true },
    };
    await processRow(row, q, repo);
    expect(repo.file(PATH)).toBe(sg("ONE", "two", "three"));
  });

  it("LOW: the same path twice in one row: both recorded 'landed', the first silently overwritten", async () => {
    const repo = new FakeRepo({ [PATH]: base });
    const q = new MemQueue();
    q.roles.set("owner", "owner");
    const row: QueueRow = {
      id: "r1", packageId: P, kind: "sync", actorId: "owner", invokerId: null, attempts: 1,
      payload: { files: [
        { path: PATH, baseVersion: h(base), text: sg("A", "two", "three") },
        { path: PATH, baseVersion: h(base), text: sg("B", "two", "three") },
      ] },
    };
    const r = await processRow(row, q, repo);
    expect(r.status).toBe("refused");
  });
});
