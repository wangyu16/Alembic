/**
 * The course committer against an in-memory queue and a fake working repo
 * (claims A4.1–A4.4, A4.6, A4.7, A4.9, A4.13, A4.14, Q.3 orchestration).
 * Real multi-connection contention (A4.5, Q.4) runs against real Postgres on
 * the testing database.
 */
import { applyCourseOp } from "./course-ops";
import type { ChainEntry, RowFile } from "./course-committer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Role } from "@alembic/package-contract";
import {
  drainCourse,
  HeadMoved,
  MAX_ATTEMPTS,
  processRow,
  RepoUnavailableError,
  type QueueRow,
  type QueueStore,
  type RowStatus,
  type WorkingRepo,
} from "./course-committer";

const h = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const sg = (...s: string[]) => "# T\n\n" + s.map((x, i) => `## S${i}\n\n${x}\n\n`).join("");

class FakeRepo implements WorkingRepo {
  commits: Array<{ sha: string; parent: string | null; files: Map<string, string>; message: string; alembic?: boolean }> = [];
  refMoves = 0;
  beforeMove?: () => void;
  failWith?: Error;
  constructor(initial: Record<string, string>) {
    this.commits.push({ sha: "c0", parent: null, files: new Map(Object.entries(initial)), message: "init" });
  }
  headSha = "c0";
  private byId(sha: string) {
    return this.commits.find((c) => c.sha === sha)!;
  }
  async head() {
    if (this.failWith) throw this.failWith;
    return this.headSha;
  }
  async readFile(ref: string, path: string) {
    if (!this.commits.some((c) => c.sha === ref)) throw Object.assign(new Error("Not Found"), { status: 404 }); // as GitHub answers
    return this.byId(ref).files.get(path) ?? null;
  }
  async listPaths(ref: string) {
    return [...this.byId(ref).files.keys()];
  }
  blobs = new Map<string, Uint8Array>();
  async readBlob(sha: string) {
    const b = this.blobs.get(sha);
    if (!b) throw Object.assign(new Error("Not Found"), { status: 404 });
    return b;
  }
  async treeAt(ref: string) {
    const out = new Map<string, { sha: string; mode: string }>();
    for (const [p, t] of this.byId(ref).files) out.set(p, { sha: t.startsWith("blob:") ? t.slice(5) : createHash("sha1").update(t).digest("hex"), mode: "100644" });
    return out;
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
  /** Simulate someone pushing on GitHub. */
  push(files: Record<string, string>) {
    const prev = this.byId(this.headSha);
    const next = new Map(prev.files);
    for (const [p, t] of Object.entries(files)) next.set(p, t);
    const sha = `c${this.commits.length}`;
    this.commits.push({ sha, parent: this.headSha, files: next, message: "outside" });
    this.headSha = sha;
  }
  async commitChain(input: { expectedHead: string; steps: Array<{ message: string; files: ChainEntry[] }>; beforeMove?: (shas: string[]) => Promise<void> }) {
    let parent = input.expectedHead;
    let files = new Map(this.byId(parent).files);
    const shas: string[] = [];
    const staged: typeof this.commits = [];
    for (const step of input.steps) {
      files = new Map(files);
      for (const f of step.files) {
        if ("blobSha" in f) files.set(f.path, `blob:${f.blobSha}`);
        else if (f.content === null) files.delete(f.path);
        else files.set(f.path, f.content);
      }
      const sha = `c${this.commits.length + staged.length}`;
      staged.push({ sha, parent, files, message: step.message, alembic: true });
      shas.push(sha);
      parent = sha;
    }
    this.beforeMove?.();
    await input.beforeMove?.(staged.map((x) => x.sha));
    if (this.headSha !== input.expectedHead) throw new HeadMoved();
    this.commits.push(...staged);
    this.headSha = parent;
    this.refMoves++;
    return { commitShas: shas, head: parent };
  }
  file(path: string) {
    return this.byId(this.headSha).files.get(path) ?? null;
  }
}

class MemQueue implements QueueStore {
  rows: Array<QueueRow & { status: string; seq: number; nextAt: number; result?: unknown; error?: string }> = [];
  roles = new Map<string, Role>();
  versions = new Map<string, string>(); // sha256 → text (what Alembic can still find)
  holder: string | null = null;
  fence = 0;
  seq = 0;
  add(row: Omit<QueueRow, "attempts">) {
    this.rows.push({ ...row, attempts: 0, status: "queued", seq: ++this.seq, nextAt: 0 });
  }
  remember(text: string) {
    this.versions.set(h(text), text);
  }
  async acquire(_p: string, holder: string) {
    if (this.holder && this.holder !== holder) return null;
    if (this.holder !== holder) this.fence++;
    this.holder = holder;
    return String(this.fence);
  }
  async next(p: string, holder: string, fence: string) {
    if (holder !== this.holder || fence !== String(this.fence)) throw new Error("lease lost");
    const open = this.rows.filter((r) => r.packageId === p && ["queued", "processing", "retry"].includes(r.status)).sort((a, b) => a.seq - b.seq);
    const r = open[0];
    if (!r || (r.status === "retry" && r.nextAt > Date.now())) return undefined;
    r.status = "processing";
    r.attempts++;
    return { ...r };
  }
  async finish(i: { id: string; status: RowStatus; result?: unknown; error?: string; retryAfterSeconds?: number }) {
    const r = this.rows.find((x) => x.id === i.id)!;
    r.status = i.status;
    r.result = i.result;
    r.error = i.error;
    if (i.status === "retry") r.nextAt = Date.now() + (i.retryAfterSeconds ?? 60) * 1000;
  }
  async roleOf(_p: string, user: string) {
    return this.roles.get(user) ?? "none";
  }
  async baseText(_p: string, _path: string, version: string) {
    return this.versions.get(version);
  }
  status(id: string) {
    return this.rows.find((r) => r.id === id)!.status;
  }
}

const P = "pkg-1";
const base = sg("one", "two", "three");

function setup() {
  const repo = new FakeRepo({ "study-guide/gases.md": base, "concepts/gases.md": "plan\n" });
  const q = new MemQueue();
  q.roles.set("owner", "owner");
  q.roles.set("co", "co-author");
  q.remember(base);
  q.remember("plan\n");
  return { repo, q };
}
const sync = (id: string, actor: string, path: string, baseText: string | null, text: string | null, fromOpenEditor = true): Omit<QueueRow, "attempts"> => ({
  id, packageId: P, kind: "sync", actorId: actor, invokerId: null,
  payload: { files: [{ path, baseVersion: baseText === null ? null : h(baseText), text }], fromOpenEditor },
});

describe("course committer", () => {
  it("A4.1 a sync from the current version lands in one commit with trailers", async () => {
    const { repo, q } = setup();
    q.add(sync("r1", "owner", "study-guide/gases.md", base, sg("ONE", "two", "three")));
    expect(await drainCourse(P, "w", q, repo)).toBe(1);
    expect(q.status("r1")).toBe("done");
    expect(repo.file("study-guide/gases.md")).toBe(sg("ONE", "two", "three"));
    expect(repo.refMoves).toBe(1);
    const msg = (await repo.recentCommits(1))[0]!.message;
    expect(msg).toContain("Alembic-Write: r1");
    expect(msg).toContain("Alembic-Actor: owner");
  });

  it("A4.2 two people editing different sections: both edits land", async () => {
    const { repo, q } = setup();
    q.add(sync("a", "owner", "study-guide/gases.md", base, sg("ONE", "two", "three")));
    q.add(sync("b", "co", "study-guide/gases.md", base, sg("one", "two", "THREE")));
    await drainCourse(P, "w", q, repo);
    expect(repo.file("study-guide/gases.md")).toBe(sg("ONE", "two", "THREE"));
    expect((q.rows[1]!.result as { files: Array<{ outcome: string }> }).files[0]!.outcome).toBe("combined");
  });

  it("A4.3 same section from an open editor: the typist's text is on top, the other version is in history", async () => {
    const { repo, q } = setup();
    q.add(sync("a", "owner", "study-guide/gases.md", base, sg("ONE", "two", "three")));
    q.add(sync("b", "co", "study-guide/gases.md", base, sg("uno", "two", "three")));
    await drainCourse(P, "w", q, repo);
    expect(repo.file("study-guide/gases.md")).toBe(sg("uno", "two", "three"));
    const texts = repo.commits.map((c) => c.files.get("study-guide/gases.md"));
    expect(texts).toContain(sg("ONE", "two", "three"));
  });

  it("A4.3 same section from Replace (not an open editor): current stays on top; kept commit then restore, one ref move", async () => {
    const { repo, q } = setup();
    q.add(sync("a", "owner", "study-guide/gases.md", base, sg("ONE", "two", "three")));
    q.add(sync("b", "co", "study-guide/gases.md", base, sg("uno", "two", "three"), false));
    await drainCourse(P, "w", q, repo);
    expect(repo.file("study-guide/gases.md")).toBe(sg("ONE", "two", "three"));
    const last = (await repo.recentCommits(2)).map((c) => c.message);
    expect(last[1]).toContain("Alembic-Kept: true");
    expect(repo.commits.at(-2)!.files.get("study-guide/gases.md")).toBe(sg("uno", "two", "three"));
    expect(repo.refMoves).toBe(2); // one per row
  });

  it("A4.4 course-plan file: current stays on top even from an open editor", async () => {
    const { repo, q } = setup();
    q.add(sync("a", "owner", "concepts/gases.md", "plan\n", "plan A\n"));
    q.add(sync("b", "co", "concepts/gases.md", "plan\n", "plan B\n"));
    await drainCourse(P, "w", q, repo);
    expect(repo.file("concepts/gases.md")).toBe("plan A\n");
    expect(repo.commits.some((c) => c.files.get("concepts/gases.md") === "plan B\n")).toBe(true);
  });

  it("A4.6 a row that already landed (crash after the ref move) is recorded, not committed again", async () => {
    const { repo, q } = setup();
    q.add(sync("r1", "owner", "study-guide/gases.md", base, sg("ONE", "two", "three")));
    const row = (await q.next(P, (await q.acquire(P, "w"), "w"), String(q.fence)))!;
    await processRow(row, q, repo); // commits
    const moves = repo.refMoves;
    const again = await processRow(row, q, repo); // replay after a crash
    expect(again).toMatchObject({ status: "done", result: { recovered: true } });
    expect(repo.refMoves).toBe(moves);
  });

  it("A4.7 a GitHub push between the decision and the ref move: decided again, nothing overwritten", async () => {
    const { repo, q } = setup();
    let pushed = false;
    repo.beforeMove = () => {
      if (!pushed) {
        pushed = true;
        repo.push({ "study-guide/gases.md": sg("one", "TWO", "three") });
      }
    };
    q.add(sync("r1", "owner", "study-guide/gases.md", base, sg("ONE", "two", "three")));
    await drainCourse(P, "w", q, repo);
    expect(repo.file("study-guide/gases.md")).toBe(sg("ONE", "TWO", "three"));
  });

  it("A4.13 records and the manifest are refused; server-only paths are refused at execution", async () => {
    const { repo, q } = setup();
    q.add(sync("r1", "owner", ".github/workflows/x.yml", null, "x"));
    q.add(sync("r2", "owner", "study-guide/gases.md", base, sg("ok", "two", "three")));
    await drainCourse(P, "w", q, repo);
    expect(q.status("r1")).toBe("refused");
    expect(q.status("r2")).toBe("done");
  });

  it("A2.8 a member removed after queueing is refused at execution", async () => {
    const { repo, q } = setup();
    q.add(sync("r1", "co", "study-guide/gases.md", base, sg("x", "two", "three")));
    q.roles.delete("co");
    await drainCourse(P, "w", q, repo);
    expect(q.status("r1")).toBe("refused");
    expect(repo.file("study-guide/gases.md")).toBe(base);
  });

  it("A2.9 an agent changeset is capped by its invoker", async () => {
    const { repo, q } = setup();
    q.add({ id: "c1", packageId: P, kind: "changeset", actorId: null, invokerId: "co", payload: { files: [{ path: "README.md", baseVersion: null, text: "x" }] } });
    q.add({ id: "c2", packageId: P, kind: "changeset", actorId: null, invokerId: "co", payload: { files: [{ path: "study-guide/gases.md", baseVersion: h(base), text: sg("agent", "two", "three") }] } });
    await drainCourse(P, "w", q, repo);
    expect(q.status("c1")).toBe("refused");
    expect(q.status("c2")).toBe("done");
    expect((await repo.recentCommits(1))[0]!.message).toContain("Alembic-On-Behalf-Of: co");
  });

  it("Q.3 outages retry and hold the course; access problems flag a reconnect; repeated errors fail", async () => {
    const { repo, q } = setup();
    q.add(sync("r1", "owner", "study-guide/gases.md", base, sg("x", "two", "three")));
    q.add(sync("r2", "owner", "study-guide/gases.md", base, sg("y", "two", "three")));
    repo.failWith = new RepoUnavailableError("outage", "GitHub is down");
    expect(await drainCourse(P, "w", q, repo)).toBe(0);
    expect(q.status("r1")).toBe("retry");
    expect(q.status("r2")).toBe("queued");

    const { repo: r2, q: q2 } = setup();
    q2.add(sync("a", "owner", "study-guide/gases.md", base, sg("x", "two", "three")));
    r2.failWith = new RepoUnavailableError("access", "installation removed");
    await drainCourse(P, "w", q2, r2);
    expect(q2.rows[0]!.result).toEqual({ needsReconnect: true });

    const { repo: r3, q: q3 } = setup();
    r3.failWith = new Error("boom");
    q3.add(sync("z", "owner", "study-guide/gases.md", base, sg("x", "two", "three")));
    const row = { ...q3.rows[0]!, attempts: MAX_ATTEMPTS };
    expect(await processRow(row, q3, r3)).toMatchObject({ status: "failed" });
  });

  it("an abandoned row is failed after MAX_ABANDONS only if it did not land; a landed one is recorded done", async () => {
    const { repo, q } = setup();
    q.add(sync("r1", "owner", "study-guide/gases.md", base, sg("x", "two", "three")));
    const row = { ...q.rows[0]!, attempts: 9, abandons: 8 };
    expect(await processRow(row, q, repo)).toMatchObject({ status: "failed" });
    const landedRow = { ...q.rows[0]!, attempts: 1 };
    await processRow(landedRow, q, repo); // lands
    expect(await processRow({ ...landedRow, attempts: 10, abandons: 9 }, q, repo)).toMatchObject({ status: "done", result: { recovered: true } });
  });

  it("GitHub errors are classified by status: outage, lost access, deterministic refusal", async () => {
    const err = (status: number, rateLimited = false) => Object.assign(new Error("gh"), { status, rateLimited });
    for (const [e, expected] of [
      [err(502), { status: "retry" }],
      [err(403, true), { status: "retry" }],
      [err(401), { status: "retry", access: true }],
      [err(404), { status: "retry", access: true }],
      [err(422), { status: "refused" }],
    ] as const) {
      const { repo, q } = setup();
      repo.failWith = e;
      q.add(sync("r", "owner", "study-guide/gases.md", base, sg("x", "two", "three")));
      expect(await processRow({ ...q.rows[0]!, attempts: 1 }, q, repo), String(e)).toMatchObject(expected);
    }
  });

  it("A4.0 a duplicate sync of identical text commits nothing", async () => {
    const { repo, q } = setup();
    q.add(sync("r1", "owner", "study-guide/gases.md", base, base));
    await drainCourse(P, "w", q, repo);
    expect(q.status("r1")).toBe("done");
    expect(repo.refMoves).toBe(0);
  });
});

describe("manifest by compare-and-swap (W-10)", () => {
  const M = (mode: "draft" | "package") => `${JSON.stringify({ schemaVersion: 3, packageId: P, title: "T", license: "CC-BY-4.0", createdAt: "2026-10-28T00:00:00Z", chapters: [{ slug: "gases", title: "Gases", mode }] }, null, 2)}\n`;
  const sys = (id: string, baseText: string | null, text: string | null): Omit<QueueRow, "attempts"> => ({
    id, packageId: P, kind: "system", actorId: "owner", invokerId: null,
    payload: { files: [{ path: "alembic.json", baseVersion: baseText === null ? null : h(baseText), text }] },
  });
  const withManifest = () => {
    const { repo, q } = setup();
    return { repo: new FakeRepo({ "alembic.json": M("draft"), "study-guide/gases.md": base }), q };
  };

  it("lands on exactly the version it was made from", async () => {
    const { repo, q } = withManifest();
    q.add(sys("m1", M("draft"), M("package")));
    await drainCourse(P, "w", q, repo);
    expect(q.status("m1")).toBe("done");
    expect(repo.file("alembic.json")).toBe(M("package"));
  });

  it("is refused when the manifest changed meanwhile (no merge)", async () => {
    const { repo, q } = withManifest();
    q.add(sys("m2", M("package"), M("draft").replace('"T"', '"T2"')));
    await drainCourse(P, "w", q, repo);
    expect(q.status("m2")).toBe("refused");
    expect(repo.file("alembic.json")).toBe(M("draft"));
  });

  it("is refused when the new text isn't a valid manifest", async () => {
    const { repo, q } = withManifest();
    q.add(sys("m3", M("draft"), "{\"schemaVersion\": 3}\n"));
    q.add(sys("m4", M("draft"), null));
    await drainCourse(P, "w", q, repo);
    expect(q.status("m3")).toBe("refused");
    expect(q.status("m4")).toBe("refused");
    expect(repo.file("alembic.json")).toBe(M("draft"));
  });

  it("a sync row still can't touch it", async () => {
    const { repo, q } = withManifest();
    q.add(sync("m5", "owner", "alembic.json", M("draft"), M("package")));
    await drainCourse(P, "w", q, repo);
    expect(q.status("m5")).toBe("refused");
  });
});

describe("course operations in the committer (contract v3 §13.3)", () => {
  const M = (chapters: Array<{ slug: string; title: string }>) =>
    `${JSON.stringify({ schemaVersion: 3, packageId: P, title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-29T00:00:00Z", chapters: chapters.map((c) => ({ ...c, mode: "package" })) }, null, 2)}\n`;
  const op = (id: string, actor: string, o: unknown): Omit<QueueRow, "attempts"> => ({ id, packageId: P, kind: "courseop", actorId: actor, invokerId: null, payload: { files: [], op: o } });
  function course() {
    const repo = new FakeRepo({ "alembic.json": M([{ slug: "gases", title: "Gases" }, { slug: "atoms", title: "Atoms" }]), "study-guide/gases.md": base, "study-guide/atoms.md": base });
    const q = new MemQueue();
    q.roles.set("owner", "owner");
    q.roles.set("dep", "deputy");
    q.roles.set("co", "co-author");
    return { repo, q };
  }
  const chapters = (repo: FakeRepo) => (JSON.parse(repo.file("alembic.json")!) as { chapters: Array<{ slug: string; title: string }> }).chapters;

  it("[K1.15] two deputies' operations queued at the same moment both land, in order, each in its own commit", async () => {
    const { repo, q } = course();
    q.add(op("o1", "owner", { op: "renameChapter", slug: "gases", title: "The Gas Laws" }));
    q.add(op("o2", "dep", { op: "renameChapter", slug: "atoms", title: "Atomic Structure" }));
    expect(await drainCourse(P, "w", q, repo)).toBe(2);
    expect([q.status("o1"), q.status("o2")]).toEqual(["done", "done"]);
    expect(chapters(repo).map((c) => c.title)).toEqual(["The Gas Laws", "Atomic Structure"]);
    expect(repo.refMoves).toBe(2);
    expect((await repo.recentCommits(1))[0]!.message).toMatch(/^Renamed chapter “Atoms” to “Atomic Structure”/);
  });
  it("[K1.15] the actor's right is re-checked when the operation runs: a co-author's, or a removed member's, is refused and nothing changes", async () => {
    const { repo, q } = course();
    q.add(op("o1", "co", { op: "removeChapter", slug: "gases" }));
    q.add(op("o2", "gone", { op: "removeChapter", slug: "gases" }));
    await drainCourse(P, "w", q, repo);
    expect([q.status("o1"), q.status("o2")]).toEqual(["refused", "refused"]);
    expect(repo.refMoves).toBe(0);
  });
  it("[K1.15] a sync queued before an operation lands first (no queue jumping), and the operation applies on top of it", async () => {
    const { repo, q } = course();
    q.add(sync("s1", "co", "study-guide/gases.md", base, sg("ONE", "two", "three"), true));
    q.add(op("o1", "owner", { op: "addChapters", titles: ["Kinetics"], startParts: false }));
    await drainCourse(P, "w", q, repo);
    expect([q.status("s1"), q.status("o1")]).toEqual(["done", "done"]);
    expect(repo.file("study-guide/gases.md")).toBe(sg("ONE", "two", "three"));
    expect(repo.file("study-guide/kinetics.md")).toMatch(/^\{\{nyml/);
    expect(chapters(repo).map((c) => c.slug)).toEqual(["gases", "atoms", "kinetics"]);
  });
  it("[K1.16] removing a chapter removes its parts in the same commit; an operation on it afterwards is refused with a reason", async () => {
    const { repo, q } = course();
    q.add(op("o1", "owner", { op: "removeChapter", slug: "gases" }));
    q.add(op("o2", "dep", { op: "renameChapter", slug: "gases", title: "Too late" }));
    await drainCourse(P, "w", q, repo);
    expect(q.status("o1")).toBe("done");
    expect(repo.file("study-guide/gases.md")).toBeNull();
    expect(q.status("o2")).toBe("refused");
    expect(q.rows.find((r) => r.id === "o2")!.result).toMatchObject({ reason: "that chapter is no longer in the course" });
  });
  it("[K1.15] a head that moves under an operation (a push on GitHub) makes it decide again on the new head", async () => {
    const { repo, q } = course();
    let once = true;
    repo.beforeMove = () => { if (once) { once = false; repo.push({ "study-guide/atoms.md": sg("pushed") }); } };
    q.add(op("o1", "owner", { op: "setChapterMode", slug: "atoms", mode: "draft" }));
    await drainCourse(P, "w", q, repo);
    expect(q.status("o1")).toBe("done");
    expect(repo.file("study-guide/atoms.md")).toBe(sg("pushed"));
    expect((JSON.parse(repo.file("alembic.json")!) as { chapters: Array<{ mode: string }> }).chapters[1]!.mode).toBe("draft");
  });

  it("[K1.16] restoreChapter (from the removal's parent) brings the chapter and its parts back; a reused slug comes back under a free one, marked restored", async () => {
    const { repo, q } = course();
    q.add(op("o1", "owner", { op: "removeChapter", slug: "gases" }));
    await drainCourse(P, "w", q, repo);
    const removal = repo.headSha;
    const parent = repo.commits.find((c) => c.sha === removal)!.parent!;
    q.add(op("o2", "dep", { op: "addChapters", titles: ["Gases"], startParts: false })); // the slug is reused meanwhile
    q.add(op("o3", "dep", { op: "restoreChapter", slug: "gases", fromCommit: parent.padEnd(40, "0") }));
    await drainCourse(P, "w", q, repo);
    expect(q.status("o3")).toBe("refused"); // no such commit in the fake: nothing restored, a reason given
    // With the real parent id (the fake's ids aren't 40 hex), apply the operation directly.
    const r = applyCourseOp(repo.file("alembic.json"), new Set(["alembic.json", "study-guide/atoms.md", "study-guide/gases.md"]),
      { op: "restoreChapter", slug: "gases", fromCommit: "a".repeat(40) }, () => "doc-x",
      { snapshot: { chapter: { slug: "gases", title: "Gases", mode: "package" }, files: [{ path: "study-guide/gases.md", content: base }] } });
    // Parts the snapshot lacked but the profile now requires are started (concept map and assessment guide: owner 2026-10-30).
    expect(r.ok && r.writes.map((w) => w.path)).toEqual(["alembic.json", "study-guide/gases-restored.md", "concepts/gases-restored.md", "assessment-support/gases-restored.md"]);
    expect(r.ok && r.manifest.chapters.at(-1)).toEqual({ slug: "gases-restored", title: "Gases (restored)", mode: "package" });
  });
  it("[K1.18] only the owner changes the licence, and LICENSE and the citation's licence line follow in the same commit", async () => {
    const { repo, q } = course();
    repo.push({ "CITATION.cff": 'cff-version: 1.2.0\ntitle: "Chem"\nlicense: CC-BY-4.0\nauthors: []' });
    q.add(op("o1", "dep", { op: "setLicense", license: "CC-BY-SA-4.0" }));
    q.add(op("o2", "owner", { op: "setLicense", license: "CC-BY-SA-4.0" }));
    await drainCourse(P, "w", q, repo);
    expect([q.status("o1"), q.status("o2")]).toEqual(["refused", "done"]);
    expect(JSON.parse(repo.file("alembic.json")!).license).toBe("CC-BY-SA-4.0");
    expect(repo.file("LICENSE")).toMatch(/ShareAlike|Share-?Alike|BY-SA/i);
    expect(repo.file("CITATION.cff")).toContain("license: CC-BY-SA-4.0");
    expect(repo.file("CITATION.cff")).not.toContain("CC-BY-4.0\n");
  });
});

describe("files that aren't text, deletes and moves (contract v3 §11)", () => {
  const SHA = (n: number) => String(n).repeat(40).slice(0, 40);
  const M = `${JSON.stringify({ schemaVersion: 3, packageId: P, title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-29T00:00:00Z", chapters: [{ slug: "gases", title: "Gases", mode: "package" }] })}\n`;
  function files() {
    const repo = new FakeRepo({ "alembic.json": M, "study-guide/gases.md": base, "assets/gases/old.png": `blob:${SHA(1)}`, "private/instructor/key.md": "answers\n" });
    const q = new MemQueue() as MemQueue & { ledger: Set<string>; blobKnown(p: string, sha: string, kind: string): Promise<boolean> };
    q.ledger = new Set([`${SHA(2)}:png`, `${SHA(3)}:png`]);
    q.blobKnown = async (_p, sha, kind) => q.ledger.has(`${sha}:${kind}`);
    q.roles.set("owner", "owner");
    q.roles.set("co", "co-author");
    return { repo, q };
  }
  const row = (id: string, actor: string, f: RowFile): Omit<QueueRow, "attempts"> => ({ id, packageId: P, kind: "sync", actorId: actor, invokerId: null, payload: { files: [f], fromOpenEditor: false } });
  const reason = (q: MemQueue, id: string) => (q.rows.find((r) => r.id === id)!.result as { reason?: string } | undefined)?.reason;

  it("[K1.10] a picture lands only as a blob in this course's upload ledger with the path's kind; a sha queued directly, or a PNG blob at an SVG path, is refused", async () => {
    const { repo, q } = files();
    q.add(row("b1", "co", { path: "assets/gases/new.png", baseVersion: null, text: null, blob: { sha: SHA(2), size: 10 }, baseBlob: null }));
    q.add(row("b2", "co", { path: "assets/gases/x.png", baseVersion: null, text: null, blob: { sha: SHA(9), size: 10 }, baseBlob: null }));
    q.add(row("b3", "co", { path: "assets/gases/x.svg", baseVersion: null, text: null, blob: { sha: SHA(3), size: 10 }, baseBlob: null }));
    await drainCourse(P, "w", q, repo);
    expect([q.status("b1"), q.status("b2"), q.status("b3")]).toEqual(["done", "refused", "refused"]);
    expect(repo.file("assets/gases/new.png")).toBe(`blob:${SHA(2)}`);
    expect(reason(q, "b2")).toMatch(/wasn't uploaded to this course/);
  });
  it("[K1.12] a picture replaced since the uploader's base keeps both: the incoming one as a kept version, the current one on top", async () => {
    const { repo, q } = files();
    q.add(row("b1", "owner", { path: "assets/gases/old.png", baseVersion: null, text: null, blob: { sha: SHA(2), size: 10 }, baseBlob: SHA(1) }));
    q.add(row("b2", "co", { path: "assets/gases/old.png", baseVersion: null, text: null, blob: { sha: SHA(3), size: 10 }, baseBlob: SHA(1) }));
    await drainCourse(P, "w", q, repo);
    expect([q.status("b1"), q.status("b2")]).toEqual(["done", "done"]);
    expect(repo.file("assets/gases/old.png")).toBe(`blob:${SHA(2)}`);
    const keptCommit = repo.commits.find((c) => c.files.get("assets/gases/old.png") === `blob:${SHA(3)}`);
    expect(keptCommit?.message).toMatch(/^Kept version/);
    expect((q.rows.find((r) => r.id === "b2")!.result as { files: Array<{ outcome: string }> }).files[0]!.outcome).toBe("both-changed");
  });
  it("[K1.13] a move takes the file from the head and removes the source in one commit; a stale base, a kind change or an occupied target is refused", async () => {
    const { repo, q } = files();
    q.add(row("m1", "co", { path: "assets/gases/moved.png", baseVersion: null, text: null, movedFrom: "assets/gases/old.png", baseBlob: SHA(1) }));
    q.add(row("m2", "co", { path: "assets/gases/again.png", baseVersion: null, text: null, movedFrom: "assets/gases/moved.png", baseBlob: SHA(7) }));
    q.add(row("m3", "co", { path: "study-guide/x.md", baseVersion: null, text: null, movedFrom: "assets/gases/moved.png", baseBlob: SHA(1) }));
    await drainCourse(P, "w", q, repo);
    expect([q.status("m1"), q.status("m2"), q.status("m3")]).toEqual(["done", "refused", "refused"]);
    expect(repo.file("assets/gases/old.png")).toBeNull();
    expect(repo.file("assets/gases/moved.png")).toBe(`blob:${SHA(1)}`);
  });
  it("[K1.13] a listed chapter's part can't be deleted or moved away; deleting in private/ needs the owner or deputy", async () => {
    const { repo, q } = files();
    q.add(row("d1", "owner", { path: "study-guide/gases.md", baseVersion: h(base), text: null }));
    q.add(row("d2", "co", { path: "private/instructor/key.md", baseVersion: h("answers\n"), text: null }));
    q.add(row("d3", "owner", { path: "private/instructor/key.md", baseVersion: h("answers\n"), text: null }));
    q.remember(base);
    q.remember("answers\n");
    await drainCourse(P, "w", q, repo);
    expect([q.status("d1"), q.status("d2"), q.status("d3")]).toEqual(["refused", "refused", "done"]);
    expect(reason(q, "d1")).toMatch(/removed with the chapter/);
    expect(repo.file("study-guide/gases.md")).toBe(base);
  });
  it("[K1.13] the course settings, licence files and harness records can't be moved or deleted through file entries, by people or by the assistant (G7 r3 H1)", async () => {
    const { repo, q } = files();
    repo.push({ LICENSE: "license text\n" });
    q.remember("license text\n");
    q.add({ id: "a1", packageId: P, kind: "changeset", actorId: null, invokerId: "owner", payload: { files: [{ path: "private/coursewerk/alembic.json", baseVersion: null, text: null, movedFrom: "alembic.json", baseBlob: null }] } });
    q.add(row("a2", "owner", { path: "LICENSE", baseVersion: h("license text\n"), text: null }));
    q.add(row("a3", "owner", { path: "assets/x.json", baseVersion: null, text: null, movedFrom: "alembic.json", baseBlob: null }));
    await drainCourse(P, "w", q, repo);
    expect([q.status("a1"), q.status("a2"), q.status("a3")]).toEqual(["refused", "refused", "refused"]);
    expect(repo.file("alembic.json")).toBe(M);
    expect(repo.file("LICENSE")).toBe("license text\n");
  });
  it("[K1.11] text with a script can't be saved to an SVG path, and text can't be saved to a picture's path", async () => {
    const { repo, q } = files();
    q.add(row("s1", "co", { path: "assets/gases/mol.ketcher.svg", baseVersion: null, text: '<svg onload="x()"></svg>' }));
    q.add(row("s2", "co", { path: "assets/gases/fake.png", baseVersion: null, text: "not a picture" }));
    q.add(row("s3", "co", { path: "assets/gases/ok.plot.svg", baseVersion: null, text: '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>' }));
    await drainCourse(P, "w", q, repo);
    expect([q.status("s1"), q.status("s2"), q.status("s3")]).toEqual(["refused", "refused", "done"]);
  });
  it("[K1.11] Door C's undo puts back what the course had even if today's check would refuse it (the rest of the undo isn't lost)", async () => {
    const { repo, q } = files();
    const old = '<!DOCTYPE svg [<!ENTITY a "x">]><svg>&a;</svg>';
    q.add({ id: "u1", packageId: P, kind: "system", actorId: null, invokerId: null, payload: { force: true, files: [{ path: "assets/legacy.svg", baseVersion: null, text: old }, { path: "assets/gases/old.png", baseVersion: null, text: null, blob: { sha: SHA(1), size: 0 } }] } });
    await drainCourse(P, "w", q, repo);
    expect(q.status("u1")).toBe("done");
    expect(repo.file("assets/legacy.svg")).toBe(old);
  });
});

describe("restores (history-v3 §3)", () => {
  const SHA = (n: number) => String(n).repeat(40).slice(0, 40);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const restore = (id: string, actor: string, f: RowFile): Omit<QueueRow, "attempts"> => ({ id, packageId: P, kind: "restore", actorId: actor, invokerId: null, payload: { files: [f] } });
  it("[H.3] a restore made from the current version lands as the newest version; one made from an older one keeps both, current on top, never combined", async () => {
    const { repo, q } = setup();
    const v2 = sg("ONE", "two", "three");
    repo.push({ "study-guide/gases.md": v2 });
    q.add(restore("r1", "co", { path: "study-guide/gases.md", baseVersion: h(v2), text: base, restoreOf: "c0" }));
    await drainCourse(P, "w", q, repo);
    expect(q.status("r1")).toBe("done");
    expect(repo.file("study-guide/gases.md")).toBe(base);
    // Someone edits a different section after the person looked; the stale restore is kept, not merged in.
    const v3 = sg("one", "two", "THREE");
    repo.push({ "study-guide/gases.md": v3 });
    q.add(restore("r2", "co", { path: "study-guide/gases.md", baseVersion: h(base), text: sg("ONE", "two", "three"), restoreOf: "c1" }));
    await drainCourse(P, "w", q, repo);
    expect(q.status("r2")).toBe("done");
    expect(repo.file("study-guide/gases.md")).toBe(v3);
    expect((q.rows.find((r) => r.id === "r2")!.result as { files: Array<{ outcome: string; reason?: string }> }).files[0]).toMatchObject({ outcome: "both-changed", reason: "restore-vs-edit" });
  });
  it("[H.8] a restored figure must be this path's own blob at the commit named, and pass the upload checks", async () => {
    const { repo, q } = setup();
    repo.push({ "assets/g/fig.png": `blob:${SHA(1)}` });
    const then = repo.headSha;
    repo.blobs.set(SHA(1), PNG);
    repo.push({ "assets/g/fig.png": `blob:${SHA(2)}` });
    q.add(restore("b1", "co", { path: "assets/g/fig.png", baseVersion: null, text: null, blob: { sha: SHA(1), size: 9 }, baseBlob: SHA(2), restoreOf: then }));
    q.add(restore("b2", "co", { path: "assets/g/fig.png", baseVersion: null, text: null, blob: { sha: SHA(9), size: 9 }, baseBlob: SHA(1), restoreOf: then }));
    await drainCourse(P, "w", q, repo);
    expect([q.status("b1"), q.status("b2")]).toEqual(["done", "refused"]);
    expect(repo.file("assets/g/fig.png")).toBe(`blob:${SHA(1)}`);
  });
});

