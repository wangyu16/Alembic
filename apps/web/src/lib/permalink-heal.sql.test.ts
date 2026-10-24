/**
 * The `/d/{docId}` stale path end to end, as the deployed route runs it:
 * the REAL route handler, access check, byte fetch, registry store and
 * sandbox store, against the real migrations (PGlite), with the service
 * client as `service_role` (closed loop r3).
 *
 * Only the edges are replaced: GitHub's raw CDN (`fetchPublicRepoBytes` —
 * here a variable that can LAG a commit, as raw.githubusercontent.com @ main
 * does for up to ~300 s), `after()` (collected so the test can await the
 * post-response work), the session, the rate limiter, view events and
 * Discover's cache signal.
 *
 *  - P5.A.6.p (M3-3): right after an educator save — commit landed, the write
 *    path updated the mirror and registered v1 — a /d view that reads v0 from
 *    the lagging CDN must not roll the registry back to v0; a pin on v1 keeps
 *    working; the old bytes are never labelled or shared-cached.
 *  - P5.A.6.r (security LOW-1): the re-registration runs as service_role, to
 *    which `documents_foreign_doc_ids` is revoked; a file carrying an
 *    embedded uid unknown to its package must still heal, and a retired or
 *    another package's uid is never adopted.
 *
 * Run under the shared heavy lock (PGlite).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { NextRequest } from "next/server";
import { newDocId } from "@alembic/package-contract";
import { computeSourceHash, registerChangedFiles } from "@alembic/package-ops";

const edge = vi.hoisted(() => ({
  db: null as unknown as import("@electric-sql/pglite").PGlite,
  /** What raw.githubusercontent.com @ main answers, per path. */
  raw: new Map<string, string>(),
  pending: [] as Array<() => unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    edge.pending.push(fn);
  },
}));
vi.mock("@alembic/github-bridge", async (orig) => ({
  ...(await orig<typeof import("@alembic/github-bridge")>()),
  fetchPublicRepoBytes: async (_repo: unknown, path: string) => {
    const s = edge.raw.get(path);
    return s === undefined ? null : new TextEncoder().encode(s);
  },
}));
vi.mock("@/lib/supabase/service", async () => {
  const { pgliteClient } = await import("./pglite-postgrest");
  return { createServiceClient: () => pgliteClient(edge.db, "service_role") };
});
vi.mock("@/lib/supabase/server", async () => {
  const { pgliteClient } = await import("./pglite-postgrest");
  return { createSupabaseServerClient: async () => pgliteClient(edge.db, "anon") };
});
vi.mock("@/lib/next-doc-bytes-layer", () => ({ nextDocBytesLayer: undefined }));
vi.mock("@/lib/rate-limit-server", () => ({ checkRateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/record-discovery-event", () => ({ recordDiscoveryEvent: () => {} }));
vi.mock("@/lib/discovery-cache", () => ({ discoveryChanged: () => {} }));

// eslint-disable-next-line import/first -- after vi.mock (hoisted)
import { asRole, freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";
// eslint-disable-next-line import/first
import { pgliteClient } from "./pglite-postgrest";
// eslint-disable-next-line import/first
import { ServiceDocumentRegistryStore, SupabaseDocumentRegistryStore } from "./document-registry-store";
// eslint-disable-next-line import/first
import { healFromMirror } from "./permalink-heal";
// eslint-disable-next-line import/first
import { SupabaseSandboxStore } from "./sandbox-store";
// eslint-disable-next-line import/first
import { GET } from "@/app/d/[docId]/route";

let db: PGlite;
let owner: string;
let stranger: string;

beforeAll(async () => {
  db = await freshDatabase();
  edge.db = db;
  owner = await seedUser(db, "edu");
  stranger = await seedUser(db, "stranger");
}, 120_000);
afterAll(async () => {
  vi.useRealTimers();
  await db?.close();
});
beforeEach(() => {
  edge.pending.length = 0;
});

let clock = Date.parse("2026-10-24T10:00:00Z");
function tick(ms: number) {
  clock += ms;
  vi.setSystemTime(clock);
}

/** GET /d/{param} through the real route, then run its post-response work. */
async function view(param: string): Promise<{ status: number; body: string; headers: Headers }> {
  const url = new URL(`/d/${param}`, "https://alembic.example");
  const res = await GET(
    { headers: new Headers({ "x-forwarded-for": "203.0.113.9" }), url: url.toString(), nextUrl: url } as unknown as NextRequest,
    { params: Promise.resolve({ docId: param }) },
  );
  const body = res.status === 304 ? "" : await res.text();
  await settle();
  return { status: res.status, body, headers: res.headers };
}
async function settle() {
  while (edge.pending.length) await edge.pending.shift()!();
  // fire-and-forget fallbacks, if any
  await new Promise((r) => setTimeout(r, 0));
}

/** The owner's own client: what the educator's save path writes with. */
const ownerDb = () => pgliteClient(db, "authenticated", owner);

/** An educator save as `writeThrough` does it after the commit: project the
 *  file into the mirror, then register it (owner session). */
async function save(packageId: string, path: string, content: string) {
  await db.query(
    `insert into public.sandbox_files (package_id, repo, path, content) values ($1, 'public', $2, $3)
     on conflict (package_id, repo, path) do update set content = excluded.content`,
    [packageId, path, content],
  );
  await registerChangedFiles(
    new SupabaseDocumentRegistryStore(ownerDb()),
    new SupabaseSandboxStore(ownerDb()),
    packageId,
    [{ repo: "public", path, content }],
    "created",
  );
}

/** The mirror moves on WITHOUT a registration (a registration that failed
 *  after the commit, or reconcile absorbed a direct commit into the mirror). */
async function mirrorOnly(packageId: string, path: string, content: string) {
  await db.query(
    `update public.sandbox_files set content = $3 where package_id = $1 and repo = 'public' and path = $2`,
    [packageId, path, content],
  );
}

async function rowAt(packageId: string, path: string) {
  const { rows } = await db.query<{ doc_id: string; source_hash: string; content_sha256: string | null }>(
    `select doc_id, source_hash, content_sha256 from public.documents
     where package_id = $1 and repo = 'public' and path = $2 and not tombstoned`,
    [packageId, path],
  );
  return rows[0] ?? null;
}

describe("/d never rolls a fresh save back (closed loop r3, M3-3)", () => {
  it("[P5.A.6.p] a view during raw-CDN lag after a save keeps the registry on the saved version, the pin on it works, old bytes are never labelled", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    const pkg = await seedPackage(db, { owner });
    const path = "study-guide/week1.md";
    const v0 = "# Week 1\nold text\n";
    const v1 = "# Week 1\nnew text (educator's save)\n";
    const h0 = computeSourceHash(v0);
    const h1 = computeSourceHash(v1);

    await save(pkg, path, v0);
    edge.raw.set(path, v0);
    const docId = (await rowAt(pkg, path))!.doc_id;

    // A reader warms it on v0.
    const warm = await view(docId);
    expect(warm.headers.get("etag")).toBe(`W/"${h0}"`);

    // The educator saves v1: committed, mirrored, registered. Raw still v0.
    tick(1_000);
    await save(pkg, path, v1);
    expect((await rowAt(pkg, path))!.source_hash).toBe(h1);

    const r1 = await view(docId);
    expect(r1.body).toBe(v0); // the CDN's old copy, unlabelled
    expect(r1.headers.get("etag")).toBeNull();
    expect((await rowAt(pkg, path))!.source_hash).toBe(h1); // never rolled back
    expect((await rowAt(pkg, path))!.doc_id).toBe(docId);

    // A pinned link to the version the educator just saved still resolves.
    const pin = await view(`${docId}@${h1}`);
    expect(pin.status).toBe(200);

    // 61 s later, raw still v0: still unlabelled, and not shared-cacheable.
    tick(61_000);
    const r2 = await view(docId);
    expect(r2.body).toBe(v0);
    expect(r2.headers.get("etag")).toBeNull();
    expect(r2.headers.get("cache-control")).not.toMatch(/public|s-maxage=[1-9]/);
    expect((await rowAt(pkg, path))!.source_hash).toBe(h1);

    // Raw catches up: the next window serves v1 labelled.
    edge.raw.set(path, v1);
    tick(61_000);
    const r3 = await view(docId);
    expect(r3.body).toBe(v1);
    expect(r3.headers.get("etag")).toBe(`W/"${h1}"`);
    expect((await rowAt(pkg, path))!.source_hash).toBe(h1);
    vi.useRealTimers();
  });
});

describe("/d pins during raw-CDN lag (closed loop r3, M3-3 residual)", () => {
  it("[P5.A.6.p] a pin on the version just saved serves that version during the raw-CDN lag, from the mirror", async () => {
    const pkg = await seedPackage(db, { owner });
    const path = "study-guide/pin.md";
    const v0 = "# Pin\nold\n";
    const v1 = "# Pin\nsaved\n";
    const h1 = computeSourceHash(v1);
    await save(pkg, path, v0);
    edge.raw.set(path, v0);
    const docId = (await rowAt(pkg, path))!.doc_id;
    await save(pkg, path, v1); // committed, mirrored, registered; raw still v0

    const pin = await view(`${docId}@${h1}`);
    expect(pin.status).toBe(200);
    expect(pin.body).toBe(v1);
    expect(pin.headers.get("etag")).toBe(`W/"${h1}"`);
    expect(pin.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  });

  it("[P5.A.6.s] when neither the origin nor the mirror holds the pinned version, the pin answers 404 (never stored) and the row is healed", async () => {
    const pkg = await seedPackage(db, { owner });
    const path = "study-guide/pin2.md";
    const v1 = "# Pin2\nsaved\n";
    const h1 = computeSourceHash(v1);
    await save(pkg, path, v1);
    const docId = (await rowAt(pkg, path))!.doc_id;
    edge.raw.set(path, "# Pin2\nolder\n"); // origin lags
    await mirrorOnly(pkg, path, "# Pin2\nnewer, unregistered\n"); // mirror moved on

    const pin = await view(`${docId}@${h1}`);
    expect(pin.status).toBe(404); // was: 200 with the lagging origin's bytes under a pin on another version
    expect(pin.body).not.toContain("older");
    expect(pin.headers.get("etag")).toBeNull();
    expect(pin.headers.get("cache-control")).toBe("no-store");
    // the heal ran (after the response): the row follows the mirror
    expect((await rowAt(pkg, path))!.source_hash).toBe(computeSourceHash("# Pin2\nnewer, unregistered\n"));
    expect((await rowAt(pkg, path))!.doc_id).toBe(docId);
  });
});

/** A self-contained document, optionally carrying an embedded uid. */
const carrier = (uid: string | null, body: string) =>
  `<html><head><script type="application/orz-meta+json" id="orz-meta">${JSON.stringify(
    uid ? { title: "T", uid } : { title: "T" },
  )}</script></head><body>${body}</body></html>`;

describe("/d heal as service_role with unknown, retired and foreign uids (closed loop r3, security LOW-1)", () => {
  it("[P5.A.6.r] the stale path re-registers from the mirror without throwing; a retired or another package's uid is never adopted, a known uid is kept", async () => {
    const pkg = await seedPackage(db, { owner });
    // Another educator's package holds FOREIGN.
    const other = await seedPackage(db, { owner: stranger });
    const FOREIGN = await seedDoc(db, { packageId: other, docId: newDocId() });
    // A deleted package retired RETIRED.
    const gone = await seedPackage(db, { owner });
    const RETIRED = await seedDoc(db, { packageId: gone, docId: newDocId() });
    await db.query(`delete from public.packages where id = $1`, [gone]);
    expect((await db.query(`select 1 from public.retired_ids where kind = 'doc' and id = $1`, [RETIRED])).rows).toHaveLength(1);
    const UNKNOWN = newDocId();

    const files = {
      known: "practice/known.md.html",
      unknown: "practice/unknown.md.html",
      retired: "practice/retired.md.html",
      foreign: "practice/foreign.md.html",
    };
    for (const p of Object.values(files)) await save(pkg, p, carrier(null, `${p} v0`));
    const ids = Object.fromEntries(
      await Promise.all(Object.entries(files).map(async ([k, p]) => [k, (await rowAt(pkg, p))!.doc_id])),
    ) as Record<keyof typeof files, string>;

    // The mirror (and GitHub) move on; the registry did not. The new bytes carry uids.
    const next = {
      known: carrier(ids.known, "known v1"),
      unknown: carrier(UNKNOWN, "unknown v1"),
      retired: carrier(RETIRED, "retired v1"),
      foreign: carrier(FOREIGN, "foreign v1"),
    };
    for (const [k, p] of Object.entries(files)) {
      await mirrorOnly(pkg, p, next[k as keyof typeof files]);
      edge.raw.set(p, next[k as keyof typeof files]);
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const k of Object.keys(files) as Array<keyof typeof files>) {
        const r = await view(ids[k]);
        expect(r.status, k).toBe(200);
        expect(r.body, k).toBe(next[k]);
      }
      // No re-registration failed (before r3: "documents_foreign_doc_ids:
      // permission denied" for every file with a uid the package lacks).
      expect(warn.mock.calls.filter((c) => /re-registration|\[registry\]/.test(String(c[0])))).toEqual([]);
    } finally {
      warn.mockRestore();
    }

    for (const k of Object.keys(files) as Array<keyof typeof files>) {
      const row = (await rowAt(pkg, files[k]))!;
      expect(row.source_hash, k).toBe(computeSourceHash(next[k])); // healed
      expect(row.doc_id, k).not.toBe(FOREIGN);
      expect(row.doc_id, k).not.toBe(RETIRED);
    }
    expect((await rowAt(pkg, files.known))!.doc_id).toBe(ids.known); // known uid kept
    // Neither borrowed id was taken by this package anywhere.
    const { rows } = await db.query(
      `select doc_id from public.documents where package_id = $1 and doc_id = any ($2)`,
      [pkg, [FOREIGN, RETIRED]],
    );
    expect(rows).toEqual([]);
    // The other package's row is untouched.
    const { rows: theirs } = await asRole(db, "service_role", () =>
      db.query<{ package_id: string }>(`select package_id from public.documents where doc_id = $1`, [FOREIGN]),
    );
    expect(theirs).toEqual([{ package_id: other }]);
  });

  it("[P5.A.6.r] the service-role store: a retired or another package's uid at a new location gets a fresh id, a known uid is kept, no throw", async () => {
    const svc = pgliteClient(db, "service_role");
    const pkg = await seedPackage(db, { owner });
    const other = await seedPackage(db, { owner: stranger });
    const FOREIGN = await seedDoc(db, { packageId: other, docId: newDocId() });
    const gone = await seedPackage(db, { owner });
    const RETIRED = await seedDoc(db, { packageId: gone, docId: newDocId() });
    await db.query(`delete from public.packages where id = $1`, [gone]);

    await save(pkg, "practice/known.md.html", carrier(null, "k0"));
    const KNOWN = (await rowAt(pkg, "practice/known.md.html"))!.doc_id;
    const files = [
      { repo: "public" as const, path: "practice/known.md.html", content: carrier(KNOWN, "k1") },
      { repo: "public" as const, path: "practice/new-retired.md.html", content: carrier(RETIRED, "r") },
      { repo: "public" as const, path: "practice/new-foreign.md.html", content: carrier(FOREIGN, "f") },
    ];
    for (const f of files) await mirrorOnly(pkg, f.path, f.content);
    for (const f of files.slice(1)) {
      await db.query(`insert into public.sandbox_files (package_id, repo, path, content) values ($1, 'public', $2, $3)`, [pkg, f.path, f.content]);
    }
    const store = new ServiceDocumentRegistryStore(svc);
    expect([...(await store.foreignDocIds(pkg, [KNOWN, RETIRED, FOREIGN, newDocId()]))].sort()).toEqual([FOREIGN, RETIRED].sort());
    await registerChangedFiles(store, new SupabaseSandboxStore(svc), pkg, files.map(({ repo, path }) => ({ repo, path })), "external-commit");

    expect((await rowAt(pkg, "practice/known.md.html"))!.doc_id).toBe(KNOWN);
    const r = (await rowAt(pkg, "practice/new-retired.md.html"))!;
    const f = (await rowAt(pkg, "practice/new-foreign.md.html"))!;
    for (const row of [r, f]) {
      expect(row.doc_id).not.toBe(RETIRED);
      expect(row.doc_id).not.toBe(FOREIGN);
      expect(row.doc_id).not.toBe(KNOWN);
    }
    expect(r.doc_id).not.toBe(f.doc_id);
  });
});

describe("healFromMirror (closed loop r3)", () => {
  it("[P5.A.6.p] writes nothing when the row already records the mirror's digest, never tombstones a file missing from the mirror, and heals a row behind the mirror", async () => {
    const svc = pgliteClient(db, "service_role");
    const pkg = await seedPackage(db, { owner });
    const path = "study-guide/h.md";
    await save(pkg, path, "# H\nv1\n");
    const row = (await rowAt(pkg, path))!;
    const doc = { doc_id: row.doc_id, package_id: pkg, repo: "public" as const, path, source_hash: row.source_hash, tombstoned: false };

    const applies = async () =>
      Number((await db.query<{ n: number }>(`select count(*)::int as n from public.documents where package_id = $1`, [pkg])).rows[0]!.n);
    const before = await applies();
    expect(await healFromMirror(svc, doc)).toBe("in-sync");
    expect(await rowAt(pkg, path)).toEqual(row);
    expect(await applies()).toBe(before);

    await mirrorOnly(pkg, path, "# H\nv2\n");
    expect(await healFromMirror(svc, doc)).toBe("healed");
    expect((await rowAt(pkg, path))!.source_hash).toBe(computeSourceHash("# H\nv2\n"));
    expect((await rowAt(pkg, path))!.doc_id).toBe(row.doc_id);

    await db.query(`delete from public.sandbox_files where package_id = $1 and path = $2`, [pkg, path]);
    expect(await healFromMirror(svc, doc)).toBe("no-mirror");
    expect((await rowAt(pkg, path))!.doc_id).toBe(row.doc_id); // still live
  });
});

describe("healFromMirror reads the mirror once (closed loop r4, security LOW-3)", () => {
  it("[P5.A.6.p] a file deleted from the mirror while a heal runs is never tombstoned: the bytes read once are the ones registered", async () => {
    const pkg = await seedPackage(db, { owner });
    const path = "study-guide/race.md";
    await save(pkg, path, "# Race\nv1\n");
    const row = (await rowAt(pkg, path))!;
    const doc = { doc_id: row.doc_id, package_id: pkg, repo: "public" as const, path, source_hash: row.source_hash, tombstoned: false };
    await mirrorOnly(pkg, path, "# Race\nv2\n");

    // The service client, except that the first read of this file's mirror row
    // is followed at once by a concurrent delete of the file.
    const base = pgliteClient(db, "service_role");
    let mirrorReads = 0;
    const racing = new Proxy(base, {
      get(target, prop, recv) {
        if (prop !== "from") return Reflect.get(target, prop, recv);
        return (table: string) => {
          const q = target.from(table);
          if (table !== "sandbox_files") return q;
          return new Proxy(q, {
            get(t, p, r) {
              if (p !== "then") return Reflect.get(t, p, r);
              return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
                (t as unknown as PromiseLike<unknown>).then(async (v) => {
                  if (mirrorReads++ === 0) {
                    await db.query(`delete from public.sandbox_files where package_id = $1 and path = $2`, [pkg, path]);
                  }
                  return v;
                }).then(ok, bad);
            },
          });
        };
      },
    }) as typeof base;

    expect(await healFromMirror(racing, doc)).toBe("healed");
    const after = await rowAt(pkg, path);
    expect(after).not.toBeNull(); // was: tombstoned — the second read found the file gone
    expect(after!.doc_id).toBe(row.doc_id);
    expect(after!.source_hash).toBe(computeSourceHash("# Race\nv2\n")); // the bytes that were read
    expect(mirrorReads).toBe(1);
  });
});
