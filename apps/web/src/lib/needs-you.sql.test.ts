/** "Needs you" items (migration 0040): life cycle, dedupe, agent limits, checkpoint cap, answer roles. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let co: string;
let pkg: string;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
const raise = async (kind: string, origin: string, key: string, o: { chapter?: string; interrupt?: boolean; addressed?: string[]; supersede?: boolean; target?: string } = {}) =>
  (await svc<{ id: string | null }>(`select public.needs_you_raise($1, $2, $3, $4, '{}'::jsonb, $5, $6, $7, $8::uuid[], $9) as id`,
    [pkg, kind, origin, key, o.chapter ?? null, o.target ?? null, o.interrupt ?? false, o.addressed ?? [], o.supersede ?? false])).rows[0]!.id;
const answer = (user: string, id: string) => asRole(db, "authenticated", () => db.query(`select public.needs_you_answer($1, '{"ok":true}'::jsonb)`, [id]), user);
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> { try { await fn(); return "ok"; } catch { return "refused"; } }

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  co = await seedUser(db, "co");
  pkg = await seedPackage(db, { owner });
  await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [pkg, co]);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("needs you", () => {
  it("the agent can only ask questions", async () => {
    expect(await raise("question", "agent", "q1")).toBeTruthy();
    for (const k of ["approve", "both-changed", "reconnect", "ready"]) {
      expect(await attempt(() => raise(k, "agent", `a-${k}`)), k).toBe("refused");
    }
  });

  it("one live item per key; an answered key never comes back", async () => {
    const a = await raise("problem", "platform", "p:study-guide/x.md:alt");
    expect(await raise("problem", "platform", "p:study-guide/x.md:alt")).toBeNull();
    await answer(co, a!);
    expect(await raise("problem", "platform", "p:study-guide/x.md:alt")).toBeNull();
  });

  it("superseding replaces the live item of a key", async () => {
    const a = await raise("approve", "platform", "approve:concepts/a.md", { chapter: "a" });
    const b = await raise("approve", "platform", "approve:concepts/a.md", { chapter: "a", supersede: true });
    expect(b).not.toBe(a);
    const { rows } = await db.query<{ state: string }>(`select state from public.needs_you where id = $1`, [a]);
    expect(rows[0]!.state).toBe("superseded");
  });

  it("checkpoints show at most 10 at a time, interrupts and approvals first", async () => {
    const p2 = await seedPackage(db, { owner });
    const r = (kind: string, key: string, interrupt = false) =>
      svc(`select public.needs_you_raise($1, $2, 'platform', $3, '{}'::jsonb, null, null, $4)`, [p2, kind, key, interrupt]);
    for (let i = 0; i < 12; i++) await r("edited-elsewhere", `e${i}`);
    await r("approve", "ap");
    await r("question", "qq", true);
    const shown = (await svc<{ id: string }>(`select public.needs_you_checkpoint($1) as id`, [p2])).rows.map((x) => x.id);
    expect(shown).toHaveLength(10);
    const { rows } = await db.query<{ kind: string }>(`select kind from public.needs_you where id = any($1::uuid[]) order by shown_at`, [shown]);
    expect(rows.map((x) => x.kind)).toContain("approve");
    expect(rows.map((x) => x.kind)).toContain("question");
    const again = (await svc<{ id: string }>(`select public.needs_you_checkpoint($1) as id`, [p2])).rows;
    expect(again).toHaveLength(0); // the cap counts items still shown
  });

  it("answers follow the role floor: co-authors can't approve, and only items addressed to them", async () => {
    const ap = await raise("approve", "platform", "approve:x");
    expect(await attempt(() => answer(co, ap!))).toBe("refused");
    expect(await attempt(() => answer(owner, ap!))).toBe("ok");
    const bc = await raise("both-changed", "platform", "bc:1", { addressed: [owner] });
    expect(await attempt(() => answer(co, bc!))).toBe("refused");
    const bc2 = await raise("both-changed", "platform", "bc:2", { addressed: [co] });
    expect(await attempt(() => answer(co, bc2!))).toBe("ok");
  });

  it("members read their items; outsiders and direct writes are refused", async () => {
    const out = await seedUser(db, "out");
    expect((await asRole(db, "authenticated", () => db.query(`select id from public.needs_you where package_id = $1`, [pkg]), out)).rows).toHaveLength(0);
    expect((await asRole(db, "authenticated", () => db.query(`select id from public.needs_you where package_id = $1`, [pkg]), co)).rows.length).toBeGreaterThan(0);
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`insert into public.needs_you (package_id, kind, origin, dedupe_key) values ($1, 'approve', 'platform', 'forged')`, [pkg]), co))).toBe("refused");
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`select public.needs_you_raise($1, 'approve', 'platform', 'k', '{}'::jsonb)`, [pkg]), owner))).toBe("refused");
  });

  it("an item whose target changed becomes obsolete", async () => {
    await raise("problem", "platform", "p:slides/a.slides.md:x", { target: "slides/a.slides.md" });
    const n = (await svc<{ n: number }>(`select public.needs_you_obsolete($1, 'slides/a.slides.md', array['problem']) as n`, [pkg])).rows[0]!.n;
    expect(n).toBe(1);
  });
});
