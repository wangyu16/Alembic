/**
 * Concurrency claims that need a real Postgres with many connections:
 *   L.3   concurrent holds on one account never take more than the balance;
 *   A4.5  N writers and several workers: commits strictly serial per course, no lost text;
 *   A4.9  lease lost before the ref moves → that attempt can't commit; the new holder lands the row once;
 *   Q.4   stale holder after takeover → the new holder finds the landed commit; no second commit,
 *         and the stale holder can't record.
 * Runs only against the TESTING project:
 *   ALEMBIC_REALPG_URL=… npx vitest run src/lib/realpg.concurrency.test.ts
 * Rows it creates are named realpg-* and are left in place (ledger entries are append-only).
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drainCourse, SqlQueueStore, type QueueStore, type SqlClient, type WorkingRepo } from "@alembic/package-ops";

const URL = process.env["ALEMBIC_REALPG_URL"] ?? "";
const ENABLED = URL.includes("whbhiqnzknxnaxlulqga"); // the testing project only, never production
const h = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const run = randomUUID().slice(0, 8);

type Sql = ReturnType<typeof postgres>;
let main: Sql;
const pools: Sql[] = [];
const pool = (max: number) => { const p = postgres(URL, { ssl: "require", max, onnotice: () => {} }); pools.push(p); return p; };
const client = (s: Sql): SqlClient => ({ query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await s.unsafe(text, (params ?? []) as never[])) as unknown as T[] }) });

async function makeUser(tag: string): Promise<string> {
  const id = randomUUID();
  const gh = String(9_000_000_000 + Math.floor(Math.random() * 1e9));
  await main.unsafe(`insert into auth.users (id, aud, role, email, raw_user_meta_data, instance_id) values ($1, 'authenticated', 'authenticated', $2, $3, '00000000-0000-0000-0000-000000000000')`,
    [id, `realpg-${run}-${tag}@test.invalid`, JSON.stringify({ user_name: `realpg-${run}-${tag}` })]);
  await main.unsafe(`insert into auth.identities (user_id, provider, provider_id, identity_data) values ($1, 'github', $2, $3)`,
    [id, gh, JSON.stringify({ sub: gh, user_name: `realpg-${run}-${tag}` })]);
  return id;
}

async function makeCourse(owner: string, tag: string): Promise<string> {
  const id = `pkg-realpg-${run}-${tag}`;
  const manifest = { schema: "alembic.package/2", packageId: id, title: `realpg ${tag}`, license: "CC-BY-4.0" };
  await main.unsafe(`insert into public.packages (id, owner_id, title, manifest, storage) values ($1, $2, $3, $4, 'sandbox')`, [id, owner, `realpg ${tag}`, JSON.stringify(manifest)]);
  return id;
}

/** A shared fake working repo with compare-and-swap on the head, and a counter of concurrent ref moves. */
function fakeRepo(initial: Record<string, string>, hooks: { afterMove?: () => Promise<void> } = {}) {
  type C = { sha: string; parent: string | null; files: Map<string, string>; message: string };
  const commits: C[] = [{ sha: "c0", parent: null, files: new Map(Object.entries(initial)), message: "init" }];
  let head = "c0";
  let inFlight = 0;
  const by = (s: string) => commits.find((c) => c.sha === s)!;
  const repo: WorkingRepo & { file(p: string): string | null; moves: number; maxConcurrent: number } = {
    moves: 0,
    maxConcurrent: 0,
    async head() { return head; },
    async readFile(ref, p) { return by(ref).files.get(p) ?? null; },
    async recentCommits(n) {
      const out = []; let c: string | null = head;
      while (c && out.length < n) { const x = by(c); out.push({ sha: x.sha, message: x.message, byAlembic: x.sha !== "c0" }); c = x.parent; }
      return out;
    },
    async commitChain({ expectedHead, steps, beforeMove }) {
      inFlight++; repo.maxConcurrent = Math.max(repo.maxConcurrent, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 15)); // give other workers a window to overlap
        if (expectedHead !== head) { const e = new Error("head moved"); (e as Error & { name: string }).name = "HeadMovedError"; throw e; }
        let parent = head; let files = new Map(by(head).files); const shas: string[] = []; const staged: C[] = [];
        for (const s of steps) {
          files = new Map(files);
          for (const f of s.files) "blobSha" in f ? files.set(f.path, `blob:${f.blobSha}`) : f.content === null ? files.delete(f.path) : files.set(f.path, f.content);
          const sha = `c${commits.length + staged.length}-${randomUUID().slice(0, 6)}`;
          staged.push({ sha, parent, files, message: s.message }); shas.push(sha); parent = sha;
        }
        await beforeMove?.(shas);
        if (expectedHead !== head) { const e = new Error("head moved"); (e as Error & { name: string }).name = "HeadMovedError"; throw e; }
        commits.push(...staged); head = parent; repo.moves++;
        await hooks.afterMove?.();
        return { commitShas: shas, head };
      } finally { inFlight--; }
    },
    file(p) { return by(head).files.get(p) ?? null; },
  };
  return repo;
}

function fullStore(s: SqlClient, bases: Map<string, string>): QueueStore & { raw: SqlQueueStore } {
  const raw = new SqlQueueStore(s);
  return {
    raw,
    acquire: raw.acquire.bind(raw), next: raw.next.bind(raw), finish: raw.finish.bind(raw), roleOf: raw.roleOf.bind(raw),
    claimCurrent: raw.claimCurrent.bind(raw), recordPlanned: raw.recordPlanned.bind(raw),
    baseText: async (_p, _path, v) => bases.get(v),
  } as QueueStore & { raw: SqlQueueStore };
}

beforeAll(() => { if (ENABLED) main = pool(4); });
afterAll(async () => { await Promise.all(pools.map((p) => p.end({ timeout: 5 }))); });

describe.skipIf(!ENABLED)("real Postgres concurrency (testing project)", () => {
  it("L.3 forty concurrent holds on one account never take more than the balance", async () => {
    const u = await makeUser("l3");
    await main.unsafe(`select public.ledger_topup($1, 100, $2)`, [u, `evt_realpg_${run}`]);
    const acc = (await main.unsafe(`select public.ledger_user_account($1) as a`, [u]))[0]!.a as string;
    const jobs: string[] = [];
    for (let i = 0; i < 40; i++) {
      jobs.push((await main.unsafe(`insert into public.ai_jobs (payer_account_id, invoker_id, kind) values ($1, $2, $3) returning id`, [acc, u, i % 4 === 0 ? "quick-ask" : "request"]))[0]!.id as string);
    }
    const p = pool(40);
    const results = await Promise.allSettled(jobs.map((j) => p.unsafe(`select public.ledger_hold($1, $2, 5)`, [u, j])));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    await p.end({ timeout: 5 }); // free plan: about 60 connections in all
    const [s] = await main.unsafe(`select public.ledger_balance($1) as bal,
        (select coalesce(sum(drawn), 0) from public.holds where account_id = $1) as drawn,
        (select count(*) from public.holds where account_id = $1) as holds`, [acc]);
    expect(Number(s!.drawn)).toBeLessThanOrEqual(100);
    expect(Number(s!.bal)).toBeGreaterThanOrEqual(0);
    expect(Number(s!.bal) + Number(s!.drawn)).toBe(100);
    expect(ok).toBe(20);
    expect(Number(s!.holds)).toBe(20);
  }, 120_000);

  it("A4.5 eight writers and three workers: commits strictly serial, every edit lands, no lost text", async () => {
    const owner = await makeUser("a45");
    const pkg = await makeCourse(owner, "a45");
    const N = 8;
    const base = Array.from({ length: N }, (_, i) => `## Part ${i}\n\nline ${i}\n`).join("\n");
    const bases = new Map([[h(base), base]]);
    const repo = fakeRepo({ "study-guide/a.md": base });
    // Writers: N concurrent inserts, each editing its own part from the same base.
    const wp = pool(N);
    const ws = new SqlQueueStore(client(wp));
    await Promise.all(Array.from({ length: N }, (_, i) => ws.insert({
      packageId: pkg, kind: "sync", idem: `w${i}-${run}`, actorId: owner,
      payload: { files: [{ path: "study-guide/a.md", baseVersion: h(base), text: base.replace(`line ${i}\n`, `line ${i} edited by writer ${i}\n`) }], fromOpenEditor: false },
    })));
    // Workers: three "processes", each with its own connections, draining in loops until the queue is empty.
    const workers = [0, 1, 2].map((w) => { const wpool = pool(2); const store = fullStore(client(wpool), bases); (store as unknown as { _pool: Sql })._pool = wpool; return { id: `worker-${w}-${run}`, store }; });
    const pending = async () => Number((await main.unsafe(`select count(*) as n from public.write_queue where package_id = $1 and status not in ('done','refused','failed','bounced')`, [pkg]))[0]!.n);
    for (let round = 0; round < 30 && (await pending()) > 0; round++) {
      await Promise.all(workers.map((w) => drainCourse(pkg, w.id, w.store, repo).catch(() => 0)));
      await main.unsafe(`update public.write_queue set next_attempt_at = now() where package_id = $1 and status = 'retry'`, [pkg]);
    }
    await Promise.all([wp, ...workers.map((w) => (w.store as unknown as { _pool?: Sql })._pool)].filter(Boolean).map((x) => x!.end({ timeout: 5 })));
    const rows = await main.unsafe(`select status from public.write_queue where package_id = $1`, [pkg]);
    expect(rows.map((r) => r.status)).toEqual(Array(N).fill("done"));
    // Stored as JSON objects, not JSON strings (postgres.js encodes jsonb-typed parameters itself).
    const shapes = await main.unsafe(`select distinct jsonb_typeof(payload) as p, jsonb_typeof(result) as r from public.write_queue where package_id = $1`, [pkg]);
    expect(shapes).toEqual([{ p: "object", r: "object" }]);
    expect(repo.maxConcurrent).toBe(1); // one writer to the course's repo at a time
    const text = repo.file("study-guide/a.md")!;
    for (let i = 0; i < N; i++) expect(text).toContain(`line ${i} edited by writer ${i}\n`);
  }, 300_000);

  it("A4.9 the lease is lost before the ref moves: that attempt can't commit; the new holder lands the row once", async () => {
    const owner = await makeUser("a49");
    const pkg = await makeCourse(owner, "a49");
    const base = "## A\n\nx\n";
    const bases = new Map([[h(base), base]]);
    const A = fullStore(client(pool(2)), bases);
    const B = fullStore(client(pool(2)), bases);
    await A.raw.insert({ packageId: pkg, kind: "sync", idem: `a49-${run}`, actorId: owner, payload: { files: [{ path: "study-guide/a.md", baseVersion: h(base), text: "## A\n\nX\n" }] } });
    const repo = fakeRepo({ "study-guide/a.md": base });
    // While A is between building its commit and moving the ref, its lease expires and B takes over.
    const realCommit = repo.commitChain.bind(repo);
    let once = true;
    repo.commitChain = async (args) => realCommit({
      ...args,
      beforeMove: async (shas) => {
        if (once) {
          once = false;
          await main.unsafe(`update public.course_committer set lease_until = now() - interval '1 second' where package_id = $1`, [pkg]);
          expect(await B.acquire(pkg, `B-${run}`)).not.toBeNull();
        }
        await args.beforeMove?.(shas);
      },
    });
    await drainCourse(pkg, `A-${run}`, A, repo).catch(() => 0);
    expect(repo.moves).toBe(0); // A's attempt stopped before the ref moved
    await main.unsafe(`update public.write_queue set next_attempt_at = now() where package_id = $1`, [pkg]);
    await drainCourse(pkg, `B-${run}`, B, repo);
    const [r] = await main.unsafe(`select status from public.write_queue where package_id = $1`, [pkg]);
    expect(r!.status).toBe("done");
    expect(repo.moves).toBe(1);
    expect(repo.file("study-guide/a.md")).toBe("## A\n\nX\n");
  }, 120_000);

  it("Q.4 stale holder after takeover: the new holder finds the landed commit, no second commit; the stale holder can't record", async () => {
    const owner = await makeUser("q4");
    const pkg = await makeCourse(owner, "q4");
    const base = "## A\n\nx\n";
    const bases = new Map([[h(base), base]]);
    const A = fullStore(client(pool(2)), bases);
    const B = fullStore(client(pool(2)), bases);
    await A.raw.insert({ packageId: pkg, kind: "sync", idem: `q4-${run}`, actorId: owner, payload: { files: [{ path: "study-guide/a.md", baseVersion: h(base), text: "## A\n\nX\n" }] } });
    let bDrained = 0;
    // A's commit lands; before A can record it, A's lease expires and B drains the course.
    const repo = fakeRepo({ "study-guide/a.md": base }, {
      afterMove: async () => {
        if (bDrained > 0) return;
        bDrained = -1;
        await main.unsafe(`update public.course_committer set lease_until = now() - interval '1 second' where package_id = $1`, [pkg]);
        await main.unsafe(`update public.write_queue set next_attempt_at = now() where package_id = $1`, [pkg]);
        bDrained = await drainCourse(pkg, `B-${run}`, B, repo);
      },
    });
    let aError: unknown = null;
    await drainCourse(pkg, `A-${run}`, A, repo).catch((e) => { aError = e; });
    const [r] = await main.unsafe(`select status from public.write_queue where package_id = $1`, [pkg]);
    expect(r!.status).toBe("done");
    expect(repo.moves).toBe(1); // no second commit
    expect(repo.file("study-guide/a.md")).toBe("## A\n\nX\n");
    expect(String((aError as Error | null)?.message ?? "")).toMatch(/lease lost/); // the stale holder couldn't record
  }, 120_000);
});
