/**
 * Publish over the real records (migrations 0042, 0057; PGlite, service role
 * for the job, the signed-in member for the request): the Publish job with
 * SqlPublishStore records runs, files and approvals; a crashed run is
 * recovered from its trailer; requests are owner/deputy only, one open per
 * course, and claimed one running per course.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { runPublish, SqlPublishStore } from "@alembic/package-ops";
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
      { runId: uuid(1), packageId: pkg, by: owner, role: "owner", choices: { publishAnyway: [], approveAndPublish: ["concepts/ch1.md", "assessment-support/ch1.md"] }, generated: { ".github/workflows/build-site.yml": "on: workflow_dispatch\n" } },
      tree(), pub, store(), []);
    expect(out.status).toBe("committed");
    expect(pub.file("study-guide/ch1.md")).toBe("# One\n");
    expect(pub.file(".github/workflows/build-site.yml")).toBe("on: workflow_dispatch\n");
    expect(pub.file("private/instructor/key.md")).toBeUndefined();
    const { rows: runs } = await db.query<{ status: string; public_sha: string }>(`select status, public_sha from public.publish_runs where package_id = $1`, [pkg]);
    expect(runs).toEqual([{ status: "committed", public_sha: pub.headSha }]);
    const { rows: files } = await db.query<{ path: string; unit: string }>(`select path, unit from public.published_files where package_id = $1 order by path`, [pkg]);
    expect(files.map((f) => f.path)).toContain("study-guide/ch1.md");
    expect(files.some((f) => f.path.startsWith(".github/"))).toBe(false); // the site build is not a unit
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
    expect(f2.some((f) => f.path.startsWith(".github/"))).toBe(false); // not generated this time
  });

  it("a run that committed but crashed before recording is recovered by the next run", async () => {
    const pkg = await course();
    const pub = new FakePublic();
    const s = store();
    // Crash: the pending row exists and the commit landed, but markCommitted never ran.
    const crashing = Object.assign(Object.create(Object.getPrototypeOf(s)) as SqlPublishStore, s, { markCommitted: async () => { throw new Error("crash"); } });
    await expect(runPublish({ runId: uuid(3), packageId: pkg, by: owner, role: "owner", choices: { publishAnyway: [], approveAndPublish: ["concepts/ch1.md", "assessment-support/ch1.md"] } }, tree(), pub, crashing, [])).rejects.toThrow("crash");
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

describe("publish requests (0057)", () => {
  const ask = (pkg: string, user: string, choices: unknown = {}) =>
    asRole(db, "authenticated", () => db.query<{ id: string }>(`select public.request_publish($1, $2::text::jsonb) as id`, [pkg, JSON.stringify(choices)]), user);

  it("owner may ask; a co-author may not; asking again returns the open request", async () => {
    const pkg = await course();
    await expect(ask(pkg, co)).rejects.toThrow(/owner or deputy/);
    const a = (await ask(pkg, owner, { approveAndPublish: ["concepts/ch1.md"] })).rows[0]!.id;
    const b = (await ask(pkg, owner)).rows[0]!.id;
    expect(b).toBe(a);
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
    // p1 asks again while running: the running one is returned, nothing new is queued.
    expect((await ask(p1, owner)).rows[0]!.id).toBe(r1);
    // A worker died 30 minutes ago.
    await db.query(`update public.publish_requests set started_at = now() - interval '30 minutes' where id = $1`, [r1]);
    expect(await claim()).toBeNull();
    const { rows } = await db.query<{ status: string }>(`select status from public.publish_requests where id = $1`, [r1]);
    expect(rows[0]!.status).toBe("failed");
    const r3 = (await ask(p1, owner)).rows[0]!.id;
    expect(r3).not.toBe(r1);
    expect(await claim()).toBe(r3);
  });
});
