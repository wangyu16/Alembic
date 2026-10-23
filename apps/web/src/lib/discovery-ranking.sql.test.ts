/**
 * Track A.3 — ranking in Postgres: relevance first, then quality signals
 * (accessibility, open licence, completeness, recency, adaptations); quality
 * changes prominence, never visibility.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
const AS_OF = "2026-10-23T10:00:00Z";

async function order(q: string | null): Promise<string[]> {
  const { rows } = await db.query<{ package_id: string }>(
    `select package_id from public.discovery_search_courses(p_q => $1, p_as_of => $2, p_limit => 50)`,
    [q, AS_OF],
  );
  return rows.map((r) => r.package_id);
}

const PASS = { status: "pass", errorCount: 0, warningCount: 0, checkedAt: "2026-10-01T00:00:00.000Z" };
const LONG = "A complete description of this course that easily runs past the fifteen words a full listing needs to have.";

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

/** Pin a course's updated_at (recency) directly in the projection. */
async function age(id: string, iso: string) {
  await db.query(`update public.discovery_courses set updated_at = $2 where package_id = $1`, [id, iso]);
}

describe("A.3 ranking", () => {
  it("[P5.A.3.c] browsing: an accessible, complete, recently updated course comes first; a bare one is still listed", async () => {
    const bare = await seedPackage(db, { owner, title: "Bare Course", listed: true });
    const good = await seedPackage(db, {
      owner,
      title: "Good Course",
      manifest: {
        description: LONG,
        keywords: ["a", "b", "c"],
        courseContext: { level: "graduate" },
        chapters: [{ slug: "a", title: "A" }, { slug: "b", title: "B" }],
        accessibility: PASS,
      },
      listed: true,
    });
    await age(bare, "2025-01-01T00:00:00Z");
    await age(good, "2026-10-20T00:00:00Z");
    const ids = await order(null);
    expect(ids.indexOf(good)).toBeLessThan(ids.indexOf(bare));
    expect(ids).toContain(bare); // prominence, not censorship
  });

  it.each([
    ["accessibility passed", { accessibility: PASS }],
    ["a more complete listing", { description: LONG, keywords: ["x", "y", "z"] }],
  ])("all else equal, %s ranks higher", async (_l, over) => {
    const a = await seedPackage(db, { owner, title: "Equal Zeta", listed: true });
    const b = await seedPackage(db, { owner, title: "Equal Zeta", manifest: over, listed: true });
    await age(a, "2026-09-01T00:00:00Z");
    await age(b, "2026-09-01T00:00:00Z");
    const ids = await order("zeta");
    expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a));
  });

  it("[P5.A.3.d] all else equal, the more recently updated ranks higher", async () => {
    const a = await seedPackage(db, { owner, title: "Equal Eta", listed: true });
    const b = await seedPackage(db, { owner, title: "Equal Eta", listed: true });
    await age(a, "2025-01-01T00:00:00Z");
    await age(b, "2026-10-01T00:00:00Z");
    const ids = await order("eta");
    expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a));
  });

  it("[P5.A.3.d] all else equal, a course others adapted ranks higher", async () => {
    const a = await seedPackage(db, { owner, title: "Equal Theta", listed: true });
    const b = await seedPackage(db, { owner, title: "Equal Theta", listed: true });
    const other = await seedUser(db, "adapter");
    for (let i = 0; i < 3; i++) {
      await seedPackage(db, {
        owner: other,
        storage: "sandbox",
        manifest: { adaptedFrom: { packageId: b, license: "CC-BY-4.0", attribution: "x" } },
      });
    }
    await age(a, "2026-09-01T00:00:00Z");
    await age(b, "2026-09-01T00:00:00Z");
    const ids = await order("theta");
    expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a));
  });

  it("[P5.A.3.b] relevance first: a title match beats a description-only match of much higher quality", async () => {
    const title = await seedPackage(db, { owner, title: "Kinetics", listed: true });
    const desc = await seedPackage(db, {
      owner,
      title: "Physical Chemistry Survey",
      manifest: {
        description: `${LONG} It touches kinetics once.`,
        keywords: ["x", "y", "z"],
        courseContext: { level: "graduate" },
        accessibility: PASS,
      },
      listed: true,
    });
    await age(title, "2024-01-01T00:00:00Z");
    await age(desc, "2026-10-22T00:00:00Z");
    const ids = await order("kinetics");
    expect(ids.indexOf(title)).toBeLessThan(ids.indexOf(desc));
  });

  it("[P5.A.3.d] elements: a described element ranks above an undescribed one with the same match", async () => {
    const pkg = await seedPackage(db, { owner, title: "Omega Figures" });
    const bare = await seedDoc(db, { packageId: pkg, description: null, path: "assets/omega-plot.svg" });
    const described = await seedDoc(db, { packageId: pkg, description: null, altText: "omega plot", path: "assets/omega-plot-2.svg" });
    const { rows } = await db.query<{ doc_id: string }>(
      `select doc_id from public.discovery_search_elements(p_package_id => $1, p_as_of => $2)`,
      [pkg, AS_OF],
    );
    const ids = rows.map((r) => r.doc_id);
    expect(ids.indexOf(described)).toBeLessThan(ids.indexOf(bare));
  });
});
