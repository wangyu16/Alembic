/**
 * Loop r1b LOW-9 (P5.B.1.p): a listing must not stop at a short page. A
 * PostgREST `max-rows` below our page size returns short pages while more
 * rows exist; a truncated listing made a registry rebuild tombstone live files.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryDocumentRegistryStore, rebuildPackageRegistry } from "@alembic/package-ops";
import { pageAll } from "./page-all";
import { SupabaseSandboxStore } from "./sandbox-store";
import { SupabaseDocumentRegistryStore } from "./document-registry-store";

// document-registry-store signals Discover (server-only next/cache); not under test here.
vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));

const CAP = 400; // the server's max-rows, below our page of 1000

/** A PostgREST double: filters are ignored (one package), every response is capped. */
function capped(tables: Record<string, Array<Record<string, unknown>>>): SupabaseClient {
  return {
    from(table: string) {
      let wantCount = false;
      const q = {
        select: (_cols: string, opts?: { count?: string }) => ((wantCount = opts?.count === "exact"), q),
        eq: () => q,
        order: () => q,
        range: async (from: number, to: number) => {
          const rows = tables[table] ?? [];
          const data = rows.slice(from, Math.min(to + 1, from + CAP));
          return { data, error: null, count: wantCount ? rows.length : null };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const files = Array.from({ length: 1300 }, (_, i) => ({
  repo: "public",
  path: `assets/f${String(i).padStart(4, "0")}.svg`,
  content: `<svg>${i}</svg>`,
  content_sha256: null,
}));

describe("listings never stop at a short page", () => {
  it("[P5.B.1.p] pageAll reads every row when the server caps pages below the page size", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => i);
    const got = await pageAll<number>(async (from, to) => ({
      data: rows.slice(from, Math.min(to + 1, from + CAP)),
      error: null,
      count: rows.length,
    }), "x");
    expect(got).toEqual(rows);
    // Without a count, only an empty page ends the walk.
    const noCount = await pageAll<number>(async (from, to) => ({ data: rows.slice(from, Math.min(to + 1, from + CAP)), error: null }), "x");
    expect(noCount).toEqual(rows);
  });

  it("[P5.B.1.p] SupabaseSandboxStore.listFiles / listPaths and the registry read return every row under a 400-row cap", async () => {
    const docs = files.map((f, i) => ({
      doc_id: `doc-${String(i).padStart(12, "0")}`, package_id: "pkg-x", repo: "public", path: f.path, space: "assets",
      kind: "svg", format_version: 0, source_hash: "h", origin: "created", author: null,
      registered_at: "2026-01-01T00:00:00.000Z", license: null, description: null, tags: [], alt_text: null,
      discoverable: false, permalink_class: "object", tombstoned: false, adapted_from: null, content_sha256: null,
    }));
    const client = capped({ sandbox_files: files, documents: docs });
    const store = new SupabaseSandboxStore(client);
    expect(await store.listFiles("pkg-x")).toHaveLength(1300);
    expect(await store.listPaths("pkg-x")).toHaveLength(1300);
    expect(await new SupabaseDocumentRegistryStore(client).listLiveByPackage("pkg-x")).toHaveLength(1300);
  });

  it("[P5.B.1.p] a rebuild over a capped listing tombstones nothing that still exists", async () => {
    const store = new SupabaseSandboxStore(capped({ sandbox_files: files }));
    const registry = new MemoryDocumentRegistryStore();
    await rebuildPackageRegistry(registry, store, "pkg-x");
    const all = await registry.listByPackage("pkg-x");
    expect(all).toHaveLength(1300);
    expect(all.filter((r) => r.tombstoned)).toEqual([]);
  });
});
