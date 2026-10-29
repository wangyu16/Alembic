/**
 * Publish over the real records (migrations 0042, 0057; PGlite, service role
 * for the job, the signed-in member for the request): the Publish job with
 * SqlPublishStore records runs, files and approvals; a crashed run is
 * recovered from its trailer; requests are owner/deputy only, one open per
 * course, and claimed one running per course.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { approvalKey, runPublish, SqlPublishStore } from "@alembic/package-ops";
import { FakePublic, h, manifestJson, working } from "../../../../packages/package-ops/src/publish-fakes";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let co: string;

const sql = {
  query: <T,>(text: string, params?: unknown[]) => asRole(db, "service_role", () => db.query<T>(text, params)),
};

async function course() {
  const pkg = await seedPackage(db, { owner });
  await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [pkg, co]);
  return pkg;
}

const PLAN = { concepts: "# Map\n", support: "# Guide\n" };
function tree() {
  return working({
    "alembic.json": manifestJson([{ slug: "ch1" }]),
    "study-guide/ch1.md": "# One\n",
    "concepts/ch1.md": PLAN.concepts,
    "assessment-support/ch1.md": PLAN.support,
    "private/instructor/key.md": "secret answers\n",
  });
}
const store = () => new SqlPublishStore(sql, { readPublic: async () => null });
const SHOWN = [approvalKey("concepts/ch1.md", h(PLAN.concepts)), approvalKey("assessment-support/ch1.md", h(PLAN.support))];
const uuid = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, "0")}`;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  co = await seedUser(db, "co");
}, 180_000);
afterAll(async () => { await db?.close(); });

describe("Publish job over the SQL records", () => {
  it("approve-and-publish: records the run, the files with blob ids, and the approvals", async () => {
    const pkg = await course();
    const pub = new FakePublic();
    const out = await runPublish(
      { runId: uuid(1), packageId: pkg, by: owner, role: "owner", choices: { publishAnyway: [], approveAndPublish: SHOWN }, generated: { ".alembic/build/build-site.mjs": "// build\n" } },
      tree(), pub, store(), []);
    expect(out.status).toBe("committed");
    expect(pub.file("study-guide/ch1.md")).toBe("# One\n");
    expect(pub.file(".alembic/build/build-site.mjs")).toBe("// build\n");
    expect(pub.file("private/instructor/key.md")).toBeUndefined();
    const { rows: runs } = await db.query<{ status: string; public_sha: string }>(`select status, public_sha from public.publish_runs where package_id = $1`, [pkg]);
    expect(runs).toEqual([{ status: "committed", public_sha: pub.headSha }]);
    const { rows: files } = await db.query<{ path: string; unit: string }>(`select path, unit from public.published_files where package_id = $1 order by path`, [pkg]);
    expect(files.map((f) => f.path)).toContain("study-guide/ch1.md");
    expect(files.some((f) => f.path.startsWith(".alembic/"))).toBe(false); // the site build is not a unit
    const { rows: ap } = await db.query<{ part_path: string; version: string }>(`select part_path, version from public.approvals where package_id = $1 order by part_path`, [pkg]);
    expect(ap).toEqual([{ part_path: "assessment-support/ch1.md", version: h(PLAN.support) }, { part_path: "concepts/ch1.md", version: h(PLAN.concepts) }]);
    const { rows: ack } = await db.query<{ public_sha: string }>(`select public_sha from public.public_acknowledged where package_id = $1`, [pkg]);
    expect(ack[0]!.public_sha).toBe(pub.headSha);

    // A second Publish: the files no longer public are removed from the records, the rest replaced.
    const out2 = await runPublish({ runId: uuid(2), packageId: pkg, by: owner, role: "owner", choices: { publishAnyway: [], approveAndPublish: [] } },
      working({ "alembic.json": manifestJson([{ slug: "ch1" }]), "study-guide/ch1.md": "# One, again\n", "concepts/ch1.md": PLAN.concepts, "assessment-support/ch1.md": PLAN.support }),
      pub, store(), []);
    expect(out2.status).toBe("committed");
    expect(pub.file("study-guide/ch1.md")).toBe("# One, again\n");
    const { rows: f2 } = await db.query<{ path: string; run_id: string }>(`select path, run_id from public.published_files where package_id = $1`, [pkg]);
    expect(f2.every((f) => f.run_id === uuid(2))).toBe(true);
    expect(f2.some((f) => f.path.startsWith(".alembic/"))).toBe(false);
  });

  it("a run that committed but crashed before recording is recovered by the next run", async () => {
    const pkg = await course();
    const pub = new FakePublic();
    const s = store();
    // Crash: the pending row exists and the commit landed, but markCommitted never ran.
    const crashing = Object.assign(Object.create(Object.getPrototypeOf(s)) as SqlPublishStore, s, { markCommitted: async () => { throw new Error("crash"); } });
    await expect(runPublish({ runId: uuid(3), packageId: pkg, by: owner, role: "owner", choices: { publishAnyway: [], approveAndPublish: SHOWN } }, tree(), pub, crashing, [])).rejects.toThrow("crash");
    const { rows: before } = await db.query<{ status: string }>(`select status from public.publish_runs where id = $1`, [uuid(3)]);
    expect(before[0]!.status).toBe("pending");
    const out = await runPublish({ runId: uuid(4), packageId: pkg, by: owner, role: "owner", choices: { publishAnyway: [], approveAndPublish: [] } }, tree(), pub, store(), []);
    expect(out.status).toBe("committed");
    const { rows } = await db.query<{ id: string; status: string }>(`select id, status from public.publish_runs where package_id = $1 order by created_at, id`, [pkg]);
    expect(rows.find((r) => r.id === uuid(3))!.status).toBe("committed");
  });

  it("a co-author can't make the first Publish (the job re-checks the role)", async () => {
    const pkg = await course();
    const out = await runPublish({ runId: uuid(5), packageId: pkg, by: co, role: "co-author", choices: { publishAnyway: [], approveAndPublish: [] } }, tree(), new FakePublic(), store(), []);
    expect(out).toEqual({ status: "stopped", reason: "Only the owner makes the first Publish" });
  });

  it("generated files must be on the generated list", async () => {
    const pkg = await course();
    await expect(runPublish({ runId: uuid(6), packageId: pkg, by: owner, role: "owner", choices: { publishAnyway: [], approveAndPublish: [] }, generated: { "study-guide/x.md": "no" } }, tree(), new FakePublic(), store(), [])).rejects.toThrow(/not a file Publish generates/);
  });
});

describe("drift brought in (review L1)", () => {
  it("one row per public head, and a new attempt only after the last one ended badly", async () => {
    const pkg = await course();
    const s = new SqlPublishStore(sql, { readPublic: async () => ({ text: "edited on GitHub" }), driftWaitMs: 1, sleep: async () => {} });
    expect(await s.bringInDrift(pkg, "a".repeat(40), ["study-guide/ch1.md"])).toBe("not-done"); // still queued
    expect(await s.bringInDrift(pkg, "a".repeat(40), ["study-guide/ch1.md"])).toBe("not-done");
    const keys = async () => (await db.query<{ idem_key: string }>(`select idem_key from public.write_queue where package_id = $1 order by seq`, [pkg])).rows.map((r) => r.idem_key);
    expect(await keys()).toEqual([`system:drift:${"a".repeat(40)}`]);
    await db.query(`update public.write_queue set status = 'failed' where package_id = $1`, [pkg]);
    await s.bringInDrift(pkg, "a".repeat(40), ["study-guide/ch1.md"]);
    expect(await keys()).toEqual([`system:drift:${"a".repeat(40)}`, `system:drift:${"a".repeat(40)}:1`]);
    await db.query(`update public.write_queue set status = 'done' where package_id = $1`, [pkg]);
    expect(await s.bringInDrift(pkg, "a".repeat(40), ["study-guide/ch1.md"])).toBe("done"); // the landed attempt
    expect((await keys()).length).toBe(2);
  });
});

describe("publish requests (0057)", () => {
  const ask = (pkg: string, user: string, choices: unknown = {}) =>
    asRole(db, "authenticated", () => db.query<{ id: string }>(`select public.request_publish($1, $2::text::jsonb) as id`, [pkg, JSON.stringify(choices)]), user);

  it("owner may ask; a co-author may not; asking again while queued replaces the choices", async () => {
    const pkg = await course();
    await expect(ask(pkg, co)).rejects.toThrow(/owner or deputy/);
    const a = (await ask(pkg, owner, { approveAndPublish: SHOWN })).rows[0]!.id;
    const b = (await ask(pkg, owner, { publishAnyway: ["ch1@" + "0".repeat(64)] })).rows[0]!.id;
    expect(b).toBe(a);
    const { rows } = await db.query<{ choices: unknown }>(`select choices from public.publish_requests where id = $1`, [a]);
    expect(rows[0]!.choices).toEqual({ approveAndPublish: [], publishAnyway: ["ch1@" + "0".repeat(64)] });
  });

  it("review H1: a non-member or a banned owner can't ask (a null role refuses)", async () => {
    const pkg = await course();
    const stranger = await seedUser(db, "outsider");
    await expect(ask(pkg, stranger)).rejects.toThrow(/owner or deputy/);
    const banned = await seedUser(db, "banned-owner");
    const pkg2 = await seedPackage(db, { owner: banned });
    await db.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [banned]);
    await expect(ask(pkg2, banned)).rejects.toThrow(/owner or deputy/);
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.publish_requests where package_id in ($1, $2)`, [pkg, pkg2]);
    expect(rows[0]!.n).toBe(0);
  });

  it("[RC.24] a Publish can't be asked for while a chapter status change is on its way; a non-member can't approve a plan part", async () => {
    const pkg = await course();
    const sql2 = { query: <T,>(t: string, p?: unknown[]) => asRole(db, "service_role", () => db.query<T>(t, p)) };
    await sql2.query(`select public.queue_insert($1, 'system', 'mode:ch1:package:x', '{"files":[]}'::jsonb, $2)`, [pkg, owner]);
    await expect(ask(pkg, owner)).rejects.toThrow(/status change is still being saved/);
    await db.query(`update public.write_queue set status = 'done' where package_id = $1`, [pkg]);
    expect((await ask(pkg, owner)).rows[0]!.id).toBeTruthy();
    const outsider = await seedUser(db, "outsider-approver");
    await expect(asRole(db, "authenticated", () => db.query(`select public.approve_part($1, 'concepts/ch1.md', $2)`, [pkg, "a".repeat(64)]), outsider)).rejects.toThrow(/Only the owner or deputy/);
  });

  it("malformed choices are refused", async () => {
    const pkg = await course();
    await expect(ask(pkg, owner, { publishAnyway: "ch1" })).rejects.toThrow(/Malformed/);
    await expect(ask(pkg, owner, [])).rejects.toThrow(/Malformed/);
  });

  it("members can read their course's requests; others can't; nobody can write them directly", async () => {
    const pkg = await course();
    await ask(pkg, owner);
    const stranger = await seedUser(db, "stranger");
    const read = (u: string) => asRole(db, "authenticated", () => db.query(`select id from public.publish_requests where package_id = $1`, [pkg]), u);
    expect((await read(co)).rows).toHaveLength(1);
    expect((await read(stranger)).rows).toHaveLength(0);
    await expect(asRole(db, "authenticated", () => db.query(`update public.publish_requests set status = 'done' where package_id = $1`, [pkg]), owner)).rejects.toThrow();
    await expect(asRole(db, "authenticated", () => db.query(`select * from public.claim_publish_request()`), owner)).rejects.toThrow();
  });

  it("claims one running request per course, oldest first; a stale run is failed and the course can go again", async () => {
    await db.query(`update public.publish_requests set status = 'done' where status in ('queued', 'running')`);
    const p1 = await course();
    const p2 = await course();
    const r1 = (await ask(p1, owner)).rows[0]!.id;
    const r2 = (await ask(p2, owner)).rows[0]!.id;
    const claim = async () => (await sql.query<{ id: string }>(`select id from public.claim_publish_request()`)).rows[0]?.id ?? null;
    expect(await claim()).toBe(r1);
    expect(await claim()).toBe(r2);
    expect(await claim()).toBeNull();
    // p1 asks again while running: refused, nothing new is queued.
    await expect(ask(p1, owner)).rejects.toThrow(/already running/);
    // A worker died 90 minutes ago.
    await db.query(`update public.publish_requests set started_at = now() - interval '90 minutes' where id = $1`, [r1]);
    expect(await claim()).toBeNull();
    const { rows } = await db.query<{ status: string }>(`select status from public.publish_requests where id = $1`, [r1]);
    expect(rows[0]!.status).toBe("failed");
    const r3 = (await ask(p1, owner)).rows[0]!.id;
    expect(r3).not.toBe(r1);
    expect(await claim()).toBe(r3);
  });
});
