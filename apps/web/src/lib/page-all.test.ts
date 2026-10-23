/**
 * Listings never lose a row (P5.B.1.p).
 *
 * Loop r1b LOW-9: a listing must not stop at a short page. A PostgREST
 * `max-rows` below our page size returns short pages while more rows exist;
 * a truncated listing made a registry rebuild tombstone live files.
 *
 * Loop r2 L-4: listings page by KEYSET, not OFFSET. With offsets a row
 * deleted between two pages shifts every later row one place back, so the
 * next page starts one row too far and a surviving row is never seen.
 *
 * The PostgREST double honours eq / gt / order / range / limit, caps every
 * response at a `max-rows` below our page, returns the exact count of the
 * rows matching the filters, and lets a test delete rows between pages.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryDocumentRegistryStore, rebuildPackageRegistry } from "@alembic/package-ops";
import { pageAllKeyset } from "./page-all";
import { SupabaseSandboxStore } from "./sandbox-store";
import { SupabaseDocumentRegistryStore } from "./document-registry-store";

vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));

type Row = Record<string, unknown>;

function postgrest(
  tables: Record<string, Row[]>,
  opts: { cap: number; afterPage?: (table: string, page: number) => void },
) {
  let requests = 0;
  const client = {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      const gts: Array<[string, string]> = [];
      const orders: string[] = [];
      let wantCount = false;
      let from = 0;
      let to = Number.POSITIVE_INFINITY;
      const run = () => {
        const page = requests++;
        const all = (tables[table] ?? [])
          .filter((r) => eqs.every(([c, v]) => r[c] === v))
          .filter((r) => gts.every(([c, v]) => String(r[c]) > v))
          .sort((a, b) => {
            for (const c of orders) {
              const x = String(a[c]);
              const y = String(b[c]);
              if (x !== y) return x < y ? -1 : 1;
            }
            return 0;
          });
        const data = all.slice(from, Math.min(to + 1, from + opts.cap));
        const out = { data, error: null, count: wantCount ? all.length : null };
        opts.afterPage?.(table, page);
        return out;
      };
      const q = {
        select: (_c: string, o?: { count?: string }) => ((wantCount = o?.count === "exact"), q),
        eq: (c: string, v: unknown) => (eqs.push([c, v]), q),
        gt: (c: string, v: string) => (gts.push([c, v]), q),
        order: (c: string) => (orders.push(c), q),
        range: (f: number, t: number) => ((from = f), (to = t), q),
        limit: (n: number) => ((to = from + n - 1), q),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve().then(run).then(res, rej),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, requests: () => requests };
}

const files = (n: number, repo = "public"): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    package_id: "pkg-x",
    repo,
    path: `assets/f${String(i).padStart(4, "0")}.svg`,
    content: `<svg>${i}</svg>`,
    content_sha256: null,
  }));

const docRows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    doc_id: `doc-${String(i).padStart(12, "0")}`, package_id: "pkg-x", repo: "public",
    path: `assets/f${String(i).padStart(4, "0")}.svg`, space: "assets", kind: "svg", format_version: 0,
    source_hash: "h", origin: "created", author: null, registered_at: "2026-01-01T00:00:00.000Z",
    license: null, description: null, tags: [], alt_text: null, discoverable: false,
    permalink_class: "object", tombstoned: false, adapted_from: null, content_sha256: null,
  }));

describe("listings survive a concurrent delete (loop r2, L-4)", () => {
  it("[P5.B.1.p] a row deleted between pages never makes a surviving row disappear (files, paths)", async () => {
    for (const list of ["listFiles", "listPaths"] as const) {
      const table = { sandbox_files: files(1300) };
      const { client } = postgrest(table, {
        cap: 400,
        // After the first page is served, someone deletes f0003 (already seen).
        afterPage: (_t, page) => {
          if (page === 0) table.sandbox_files = table.sandbox_files.filter((r) => r["path"] !== "assets/f0003.svg");
        },
      });
      const got = (await new SupabaseSandboxStore(client)[list]("pkg-x")).map((f) => f.path);
      const survivors = table.sandbox_files.map((r) => r["path"]);
      for (const p of survivors) expect(got, `${list} lost ${String(p)}`).toContain(p);
    }
  });

  it("[P5.B.1.p] the registry read never skips a surviving row when one is deleted between pages", async () => {
    const table = { documents: docRows(1300) };
    const { client } = postgrest(table, {
      cap: 400,
      afterPage: (_t, page) => {
        if (page === 0) table.documents = table.documents.filter((r) => r["doc_id"] !== "doc-000000000003");
      },
    });
    const got = (await new SupabaseDocumentRegistryStore(client).listLiveByPackage("pkg-x")).map((r) => r.docId);
    for (const r of table.documents) expect(got).toContain(r["doc_id"]);
  });

  it("[P5.B.1.p] both repos are listed, each file once, under a row cap", async () => {
    const { client } = postgrest({ sandbox_files: [...files(700, "public"), ...files(650, "private")] }, { cap: 400 });
    const got = await new SupabaseSandboxStore(client).listFiles("pkg-x");
    expect(got).toHaveLength(1350);
    expect(new Set(got.map((f) => `${f.repo}:${f.path}`)).size).toBe(1350);
  });
});

describe("listings never stop at a short page (loop r1b, LOW-9)", () => {
  it("[P5.B.1.p] pageAllKeyset reads every row when the server caps pages below the page size", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => i);
    const fetch = (withCount: boolean) => async (after: number | null, limit: number) => {
      const rest = rows.filter((r) => after === null || r > after);
      return { data: rest.slice(0, Math.min(limit, 400)), error: null, count: withCount ? rest.length : null };
    };
    expect(await pageAllKeyset(fetch(true), (r) => r, "x")).toEqual(rows);
    // Without a count, only an empty page ends the walk.
    expect(await pageAllKeyset(fetch(false), (r) => r, "x")).toEqual(rows);
  });

  it("[P5.B.1.p] SupabaseSandboxStore.listFiles / listPaths and the registry read return every row under a 400-row cap", async () => {
    const { client } = postgrest({ sandbox_files: files(1300), documents: docRows(1300) }, { cap: 400 });
    const store = new SupabaseSandboxStore(client);
    expect(await store.listFiles("pkg-x")).toHaveLength(1300);
    expect(await store.listPaths("pkg-x")).toHaveLength(1300);
    expect(await new SupabaseDocumentRegistryStore(client).listLiveByPackage("pkg-x")).toHaveLength(1300);
  });

  it("[P5.B.1.p] a rebuild over a capped listing tombstones nothing that still exists", async () => {
    const store = new SupabaseSandboxStore(postgrest({ sandbox_files: files(1300) }, { cap: 400 }).client);
    const registry = new MemoryDocumentRegistryStore();
    await rebuildPackageRegistry(registry, store, "pkg-x");
    const all = await registry.listByPackage("pkg-x");
    expect(all).toHaveLength(1300);
    expect(all.filter((r) => r.tombstoned)).toEqual([]);
  });
});

describe("keyset paging cost (loop r2, L-4)", () => {
  it("[P5.B.1.p] N rows cost ceil(N/1000) round-trips (min 1) when the count is returned — never an extra empty page", async () => {
    for (const n of [0, 999, 1000, 1001, 3000]) {
      const rows = Array.from({ length: n }, (_, i) => i);
      let trips = 0;
      const got = await pageAllKeyset(
        async (after: number | null, limit: number) => {
          trips++;
          const rest = rows.filter((r) => after === null || r > after);
          return { data: rest.slice(0, limit), error: null, count: rest.length };
        },
        (r) => r,
        "x",
      );
      expect(got, `n=${n}`).toEqual(rows);
      expect(trips, `n=${n}`).toBe(Math.max(1, Math.ceil(n / 1000)));
    }
  });

  it("[P5.B.1.p] a failed page throws (a partial listing is never returned)", async () => {
    await expect(
      pageAllKeyset(async () => ({ data: null, error: { message: "boom" } }), (r: number) => r, "Could not load files"),
    ).rejects.toThrow("Could not load files: boom");
  });
});
