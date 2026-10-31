/** Contact form messages and their automatic sorting (migration 0062). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedUser } from "./discovery-pglite";

let db: PGlite;
let op: string;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
async function attempt(fn: () => Promise<unknown>): Promise<string> { try { await fn(); return "ok"; } catch (e) { return (e as Error).message; } }
const net = (c: string) => c.repeat(64);
const submit = (message: string, network = "a", topic = "using") =>
  svc<{ r: string }>(`select public.contact_submit('Ada', 'ada@example.edu', null, $1, $2, '/guide', $3) as r`, [topic, message, net(network)]);
const take = (limit: number, cap: number) =>
  svc<{ id: string; topic: string; message: string }>(`select * from public.contact_triage_take($1, $2)`, [limit, cap]);
const list = (view = "open", actor = op) =>
  svc<{ id: string; status: string; category: string | null; summary: string | null }>(`select * from public.contact_list($1, $2)`, [actor, view]);

beforeAll(async () => {
  db = await freshDatabase();
  op = await seedUser(db, "op");
  await db.query(`update public.profiles set is_admin = true where id = $1`, [op]);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("contact messages", () => {
  it("[RC.27] visitors and signed-in people can neither read nor file messages directly; only the operator reads them", async () => {
    expect((await submit("How do I share a chapter?")).rows[0]!.r).toBe("ok");
    const u = await seedUser(db, "visitor");
    for (const [role, who] of [["anon", undefined], ["authenticated", u]] as const) {
      expect(await attempt(() => asRole(db, role, () => db.query(`select * from public.contact_messages`), who))).not.toBe("ok");
      expect(await attempt(() => asRole(db, role, () => db.query(
        `insert into public.contact_messages (name, email, topic, message, net_hash) values ('x', 'x@y.z', 'other', 'hi', $1)`, [net("b")]), who))).not.toBe("ok");
      expect(await attempt(() => asRole(db, role, () => db.query(`select * from public.contact_triage_days`), who))).not.toBe("ok");
      expect(await attempt(() => asRole(db, role, () => db.query(
        `select public.contact_submit('x', 'x@y.z', null, 'other', 'hi', null, $1)`, [net("b")]), who))).not.toBe("ok");
      expect(await attempt(() => asRole(db, role, () => db.query(`select * from public.contact_list($1, 'open')`, [op]), who))).not.toBe("ok");
      expect(await attempt(() => asRole(db, role, () => db.query(`select * from public.contact_triage_take(5, 5)`), who))).not.toBe("ok");
    }
    // Through the service role, the operator reads; anyone else is refused.
    expect((await list()).rows.map((r) => r.status)).toEqual(["new"]);
    expect(await attempt(() => list("open", u))).toMatch(/operator/);
    expect(await attempt(() => svc(`select public.contact_mark($1, (select id from public.contact_messages limit 1), 'spam')`, [u]))).toMatch(/operator/);
    // The table refuses what the form refuses (lengths, email, topic, raw addresses as the network).
    expect(await attempt(() => submit("x".repeat(4001)))).not.toBe("ok");
    expect(await attempt(() => submit("hi", "a", "please-route-me"))).not.toBe("ok");
    expect(await attempt(() => svc(`select public.contact_submit('Ada', 'not an email', null, 'using', 'hi', null, $1)`, [net("c")]))).not.toBe("ok");
    expect(await attempt(() => svc(`select public.contact_submit('Ada', 'a@b.co', null, 'using', 'hi', null, '203.0.113.9')`))).not.toBe("ok");
    await db.query(`delete from public.contact_messages`);
  });

  it("[RC.30] sorting takes at most the day's cap, writes only the four fields, and a message it can't sort stays open and listed", async () => {
    for (let i = 0; i < 5; i++) await submit(`message ${i}`, "d");
    // A cap of 3 for the day: 2 now, 1 more later, then nothing however many are asked for.
    expect((await take(2, 3)).rows).toHaveLength(2);
    const second = (await take(10, 3)).rows;
    expect(second).toHaveLength(1);
    expect((await take(10, 3)).rows).toHaveLength(0);
    expect((await take(10, 100_000)).rows.length).toBeLessThanOrEqual(2); // the caller can't lift it past 1000/day, and only 2 are left
    const [first] = (await svc<{ id: string }>(`select id from public.contact_messages where triage_attempts = 1 order by created_at limit 1`)).rows;
    await svc(`select public.contact_triage_apply($1, 'bug', 'high', 'Cannot open a chapter.', false)`, [first!.id]);
    // Applying again (or after the operator acted) changes nothing.
    expect((await svc<{ r: boolean }>(`select public.contact_triage_apply($1, 'other', 'low', 'x', true) as r`, [first!.id])).rows[0]!.r).toBe(false);
    // A value outside the fixed lists is refused by the table itself.
    const other = (await svc<{ id: string }>(`select id from public.contact_messages where status = 'new' limit 1`)).rows[0]!.id;
    expect(await attempt(() => svc(`select public.contact_triage_apply($1, 'send-email', 'high', 'x', false)`, [other]))).not.toBe("ok");
    expect(await attempt(() => svc(`select public.contact_triage_apply($1, 'bug', 'high', e'two\\nlines', false)`, [other]))).not.toBe("ok");
    const open = (await list()).rows;
    expect(open).toHaveLength(5); // the unsorted ones are listed too
    expect(open.filter((r) => r.status === "sorted").map((r) => r.summary)).toEqual(["Cannot open a chapter."]);
    // A message whose sorting failed three times stays 'new' (still listed), and isn't taken again.
    await db.query(`update public.contact_messages set triage_attempts = 3, triage_claimed_at = null where status = 'new'`);
    await db.query(`delete from public.contact_triage_days`);
    expect((await take(10, 50)).rows).toHaveLength(0);
    expect((await list()).rows.filter((r) => r.status === "new")).toHaveLength(4);
  });

  it("the operator closes, marks spam and reopens; each view shows its own", async () => {
    const ids = (await list()).rows.map((r) => r.id);
    await svc(`select public.contact_mark($1, $2, 'handled', 'Replied by email')`, [op, ids[0]]);
    await svc(`select public.contact_mark($1, $2, 'spam')`, [op, ids[1]]);
    expect((await list("handled")).rows.map((r) => r.id)).toEqual([ids[0]]);
    expect((await list("spam")).rows.map((r) => r.id)).toEqual([ids[1]]);
    expect((await list("open")).rows).toHaveLength(ids.length - 2);
    const note = (await svc<{ handled_note: string }>(`select handled_note from public.contact_messages where id = $1`, [ids[0]])).rows[0]!.handled_note;
    expect(note).toBe("Replied by email");
    await svc(`select public.contact_mark($1, $2, 'open')`, [op, ids[1]]);
    expect((await list("spam")).rows).toHaveLength(0);
    expect(await attempt(() => svc(`select public.contact_mark($1, $2, 'deleted')`, [op, ids[2]]))).toMatch(/bad status/);
  });

  it("the database caps one network per day", async () => {
    await db.query(`delete from public.contact_messages`);
    for (let i = 0; i < 30; i++) expect((await submit(`m${i}`, "e")).rows[0]!.r).toBe("ok");
    expect((await submit("one more", "e")).rows[0]!.r).toBe("busy");
    expect((await submit("another network", "f")).rows[0]!.r).toBe("ok");
  });
});
