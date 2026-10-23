/**
 * Security loop r1, finding M1 (audit L4c) — against a real Postgres (PGlite
 * with every migration applied): no API role may insert into research_events;
 * only the server (service role) writes events. Before migration 0025 any
 * signed-in user could insert arbitrary events for themselves.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedUser } from "./discovery-pglite";

let db: PGlite;
let user: string;

beforeAll(async () => {
  db = await freshDatabase();
  user = await seedUser(db);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

const insert = (userId: string | null) =>
  db.query(
    `insert into public.research_events (type, user_id, package_id, detail, occurred_at)
     values ('publish.completed', $1, 'pkg-x', '{"siteUrl":"https://evil.example"}', now())`,
    [userId],
  );

async function count(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.research_events`);
  return rows[0]!.n;
}

describe("research_events: server-only writes (security loop r1, M1)", () => {
  it("[P5.S.2.b] a signed-in user cannot insert an event, not even their own", async () => {
    const before = await count();
    await expect(asRole(db, "authenticated", () => insert(user), user)).rejects.toThrow(
      /permission denied|row-level security/i,
    );
    expect(await count()).toBe(before);
  });

  it("[P5.S.2.b] an anonymous visitor cannot insert an event", async () => {
    const before = await count();
    await expect(asRole(db, "anon", () => insert(null))).rejects.toThrow(/permission denied|row-level security/i);
    expect(await count()).toBe(before);
  });

  it("[P5.S.2.b] the service role (the server-side writer) still inserts events", async () => {
    const before = await count();
    await asRole(db, "service_role", () => insert(user));
    await asRole(db, "service_role", () => insert(null)); // anonymous discovery event
    expect(await count()).toBe(before + 2);
  });

  it("[P5.S.2.b] the owner-insert policy is gone", async () => {
    const { rows } = await db.query(
      `select policyname from pg_policies where schemaname = 'public' and tablename = 'research_events'`,
    );
    expect(rows).toEqual([]);
  });
});
