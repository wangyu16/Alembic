/**
 * The course committer end to end over the real queue SQL (migrations
 * 0036–0037, PGlite, service role) and a fake working repo: insert → drain →
 * commits → recorded results; removal and bans honoured at execution.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { drainCourse, SqlQueueStore, type QueueStore, type WorkingRepo } from "@alembic/package-ops";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

const h = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

let db: PGlite;
let owner: string;
let co: string;

/** Every SQL call as the service role, like the worker. */
const sql = {
  query: <T,>(text: string, params?: unknown[]) => asRole(db, "service_role", () => db.query<T>(text, params)),
};

function fakeRepo(initial: Record<string, string>): WorkingRepo & { file(p: string): string | null; moves: number } {
  const commits = [{ sha: "c0", parent: null as string | null, files: new Map(Object.entries(initial)), message: "init" }];
  let head = "c0";
  const by = (s: string) => commits.find((c) => c.sha === s)!;
  return {
    moves: 0,
    async head() { return head; },
    async readFile(ref, p) { return by(ref).files.get(p) ?? null; },
    async recentCommits(n) { const out = []; let c: string | null = head; while (c && out.length < n) { const x = by(c); out.push({ sha: x.sha, message: x.message }); c = x.parent; } return out; },
    async commitChain({ expectedHead, steps }) {
      if (expectedHead !== head) throw new Error("moved");
      let parent = head; let files = new Map(by(head).files); const shas: string[] = [];
      for (const s of steps) { files = new Map(files); for (const f of s.files) f.content === null ? files.delete(f.path) : files.set(f.path, f.content); const sha = `c${commits.length}`; commits.push({ sha, parent, files, message: s.message }); shas.push(sha); parent = sha; }
      head = parent; this.moves++; return { commitShas: shas, head };
    },
    file(p) { return by(head).files.get(p) ?? null; },
  };
}

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  co = await seedUser(db, "co");
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("committer over the real queue SQL", () => {
  it("drains in order, commits, and records results", async () => {
    const pkg = await seedPackage(db, { owner });
    const store = new SqlQueueStore(sql);
    const base = "# A\n\n## S1\n\nx\n\n## S2\n\ny\n";
    const full: QueueStore = { ...store, acquire: store.acquire.bind(store), next: store.next.bind(store), finish: store.finish.bind(store), roleOf: store.roleOf.bind(store), baseText: async (_p, _path, v) => (v === h(base) ? base : undefined) };
    const repo = fakeRepo({ "study-guide/a.md": base });
    const a = await store.insert({ packageId: pkg, kind: "sync", idem: "a", actorId: owner, payload: { files: [{ path: "study-guide/a.md", baseVersion: h(base), text: base.replace("x", "X") }], fromOpenEditor: true } });
    const b = await store.insert({ packageId: pkg, kind: "sync", idem: "b", actorId: owner, payload: { files: [{ path: "study-guide/a.md", baseVersion: h(base), text: base.replace("y", "Y") }], fromOpenEditor: true } });
    expect(await drainCourse(pkg, "w1", full, repo)).toBe(2);
    expect(repo.file("study-guide/a.md")).toBe(base.replace("x", "X").replace("y", "Y"));
    const { rows } = await db.query<{ id: string; status: string; result: { files: Array<{ outcome: string }> } }>(
      `select id, status, result from public.write_queue where package_id = $1 order by seq`, [pkg]);
    expect(rows.map((r) => [r.id, r.status])).toEqual([[a, "done"], [b, "done"]]);
    expect(rows[1]!.result.files[0]!.outcome).toBe("combined");
  });

  it("a member removed after queueing is refused at execution; nothing is committed", async () => {
    const pkg = await seedPackage(db, { owner });
    await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [pkg, co]);
    const store = new SqlQueueStore(sql);
    const repo = fakeRepo({ "study-guide/a.md": "x" });
    await store.insert({ packageId: pkg, kind: "sync", idem: "c", actorId: co, payload: { files: [{ path: "study-guide/a.md", baseVersion: h("x"), text: "y" }] } });
    await db.query(`delete from public.course_members where package_id = $1 and user_id = $2`, [pkg, co]);
    const full: QueueStore = { acquire: store.acquire.bind(store), next: store.next.bind(store), finish: store.finish.bind(store), roleOf: store.roleOf.bind(store), baseText: async () => undefined };
    await drainCourse(pkg, "w1", full, repo);
    const { rows } = await db.query<{ status: string }>(`select status from public.write_queue where package_id = $1`, [pkg]);
    expect(rows[0]!.status).toBe("refused");
    expect(repo.moves).toBe(0);
  });

  it("a banned owner has no role at execution", async () => {
    const u = await seedUser(db, "banned-owner");
    const pkg = await seedPackage(db, { owner: u });
    await db.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [u]);
    const store = new SqlQueueStore(sql);
    expect(await store.roleOf(pkg, u)).toBe("none");
    expect(await store.roleOf(pkg, owner)).toBe("none");
  });

  it("a second worker can't drain a course while the first holds the lease", async () => {
    const pkg = await seedPackage(db, { owner });
    const store = new SqlQueueStore(sql);
    expect(await store.acquire(pkg, "w1")).not.toBeNull();
    const repo = fakeRepo({});
    const full: QueueStore = { acquire: store.acquire.bind(store), next: store.next.bind(store), finish: store.finish.bind(store), roleOf: store.roleOf.bind(store), baseText: async () => undefined };
    expect(await drainCourse(pkg, "w2", full, repo)).toBe(0);
  });
});
