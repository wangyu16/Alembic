import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseSandboxStore } from "./sandbox-store";

/**
 * listFiles must page past PostgREST's per-response row cap (default
 * max-rows, typically 1000): a single unpaged select silently truncates
 * large packages, corrupting every whole-package operation downstream.
 * These tests drive the store with a minimal chainable Supabase stub that
 * serves rows through `.range()` windows.
 */

const PAGE = 1000;

type Row = { repo: "public" | "private"; path: string; content: string };
type RangeCall = { from: number; to: number };

/** All rows for the package, pre-sorted by (repo, path) like PostgREST would. */
function makeRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      repo: "public",
      path: `chapters/ch-${String(i).padStart(5, "0")}.md`,
      content: `content ${i}`,
    });
  }
  return rows;
}

/**
 * Minimal chainable stub: from().select().eq().order().range() where range
 * resolves to `{ data, error }` — the shape the store awaits. `failOnPage`
 * (0-based) makes that range call return an error instead of rows.
 */
function makeStubClient(
  rows: Row[],
  opts: { failOnPage?: number; failMessage?: string } = {},
) {
  const rangeCalls: RangeCall[] = [];
  const eqCalls: { column: string; value: unknown }[] = [];
  const orderCalls: string[] = [];
  let selected = "";
  let table = "";

  const builder = {
    select(columns: string) {
      selected = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      eqCalls.push({ column, value });
      return builder;
    },
    order(column: string) {
      orderCalls.push(column);
      return builder;
    },
    range(from: number, to: number) {
      const page = rangeCalls.length;
      rangeCalls.push({ from, to });
      if (opts.failOnPage === page) {
        return Promise.resolve({
          data: null,
          error: { message: opts.failMessage ?? "boom" },
        });
      }
      return Promise.resolve({
        data: rows.slice(from, to + 1),
        error: null,
      });
    },
  };

  const client = {
    from(name: string) {
      table = name;
      return builder;
    },
  } as unknown as SupabaseClient;

  return {
    client,
    rangeCalls,
    eqCalls,
    orderCalls,
    get table() {
      return table;
    },
    get selected() {
      return selected;
    },
  };
}

describe("SupabaseSandboxStore.listFiles — pagination", () => {
  it("accumulates 2 full pages + a partial third, in order", async () => {
    const rows = makeRows(PAGE * 2 + 500);
    const stub = makeStubClient(rows);
    const store = new SupabaseSandboxStore(stub.client);

    const files = await store.listFiles("pkg-1");

    expect(files).toHaveLength(PAGE * 2 + 500);
    expect(files).toEqual(rows);
    // Deterministic paging: three range windows, PAGE rows wide each.
    expect(stub.rangeCalls).toEqual([
      { from: 0, to: PAGE - 1 },
      { from: PAGE, to: PAGE * 2 - 1 },
      { from: PAGE * 2, to: PAGE * 3 - 1 },
    ]);
    // Every page filters by package and orders by (repo, path).
    expect(stub.table).toBe("sandbox_files");
    expect(stub.selected).toBe("repo, path, content");
    expect(stub.eqCalls.every((c) => c.column === "package_id")).toBe(true);
    expect(stub.eqCalls.every((c) => c.value === "pkg-1")).toBe(true);
    expect(stub.orderCalls).toEqual([
      "repo",
      "path",
      "repo",
      "path",
      "repo",
      "path",
    ]);
  });

  it("stops after a single short page (small package)", async () => {
    const rows = makeRows(3);
    const stub = makeStubClient(rows);
    const store = new SupabaseSandboxStore(stub.client);

    const files = await store.listFiles("pkg-small");

    expect(files).toEqual(rows);
    expect(stub.rangeCalls).toHaveLength(1);
  });

  it("returns [] for a package with no files", async () => {
    const stub = makeStubClient([]);
    const store = new SupabaseSandboxStore(stub.client);

    const files = await store.listFiles("pkg-empty");

    expect(files).toEqual([]);
    expect(stub.rangeCalls).toHaveLength(1);
  });

  it("fetches exactly one extra (empty) page when the total is a page multiple", async () => {
    const rows = makeRows(PAGE * 2);
    const stub = makeStubClient(rows);
    const store = new SupabaseSandboxStore(stub.client);

    const files = await store.listFiles("pkg-exact");

    expect(files).toHaveLength(PAGE * 2);
    expect(files).toEqual(rows);
    expect(stub.rangeCalls).toHaveLength(3);
  });

  it("throws the existing 'Could not load files' message when page 2 errors", async () => {
    const rows = makeRows(PAGE * 2 + 500);
    const stub = makeStubClient(rows, {
      failOnPage: 1,
      failMessage: "connection reset",
    });
    const store = new SupabaseSandboxStore(stub.client);

    await expect(store.listFiles("pkg-err")).rejects.toThrow(
      "Could not load files: connection reset",
    );
    expect(stub.rangeCalls).toHaveLength(2);
  });
});
