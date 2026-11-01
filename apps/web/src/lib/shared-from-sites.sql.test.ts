/** Discover's list of elements shared from course websites (element-sharing-v3 §5) on real Postgres. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, seedPackage, seedUser } from "./discovery-pglite";
import { sharedFromSites } from "./shared-from-sites";

let db: PGlite;
let pkg: string, archived: string;
const sql = { query: async (text: string, params?: unknown[]) => ({ rows: (await db.query(text, params ?? [])).rows as never[] }) };
const share = (id: string, p: string, path: string, title: string, stopped = false) =>
  db.query(`insert into public.shared_elements (id, package_id, path, kind, page, title, stopped_at) values ($1, $2, $3, 'figure', 'study-guide/atoms.md', $4, $5)`, [id, p, path, title, stopped ? new Date().toISOString() : null]);
let owner: string;
const publish = async (p: string, path: string) => {
  const run = (await db.query<{ id: string }>(`insert into public.publish_runs (package_id, by_user, working_sha, status) values ($1, $2, repeat('b', 40), 'committed') returning id`, [p, owner])).rows[0]!.id;
  await db.query(`insert into public.published_files (package_id, path, unit, blob_sha, run_id) values ($1, $2, 'atoms', repeat('a', 40), $3)`, [p, path, run]);
};

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  pkg = await seedPackage(db, { owner, title: "General Chemistry" });
  archived = await seedPackage(db, { owner, title: "Old course" });
  await db.query(`update public.packages set archived_at = now() where id = $1`, [archived]);
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("Discover: elements shared from course websites", () => {
  it("[K1.47] lists only active shares that are on a website, of courses not archived, newest first; the search text is literal", async () => {
    await publish(pkg, "assets/atoms/atom.svg");
    await publish(pkg, "assets/atoms/iso.svg");
    await publish(archived, "assets/x/old.svg");
    await share("el-aaaaaaaaaaa1", pkg, "assets/atoms/atom.svg", "Atom diagram");
    await share("el-aaaaaaaaaaa2", pkg, "assets/atoms/iso.svg", "Isotopes 100% clear");
    await share("el-aaaaaaaaaaa3", pkg, "assets/atoms/never.svg", "Never published");
    await share("el-aaaaaaaaaaa4", pkg, "assets/atoms/atom.svg", "Stopped one", true);
    await share("el-aaaaaaaaaaa5", archived, "assets/x/old.svg", "From an archived course");
    expect((await sharedFromSites(sql, null)).map((r) => r.id).sort()).toEqual(["el-aaaaaaaaaaa1", "el-aaaaaaaaaaa2"]);
    expect((await sharedFromSites(sql, "isotopes")).map((r) => r.id)).toEqual(["el-aaaaaaaaaaa2"]);
    expect((await sharedFromSites(sql, "100%")).map((r) => r.id)).toEqual(["el-aaaaaaaaaaa2"]);
    expect((await sharedFromSites(sql, "%")).map((r) => r.id)).toEqual(["el-aaaaaaaaaaa2"]); // a literal percent sign, not "anything"
    expect(await sharedFromSites(sql, "a_om")).toEqual([]); // "_" is literal too
    expect((await sharedFromSites(sql, "general chem")).length).toBe(2); // the course's title matches too
  });
});
