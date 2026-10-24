import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseSandboxStore } from "./sandbox-store";

// sandbox-store → document-registry-store signals Discover (server-only next/cache); not under test here.
vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));

/**
 * listFiles must page past PostgREST's per-response row cap (default
 * max-rows, typically 1000): a single unpaged select silently truncates
 * large packages, corrupting every whole-package operation downstream.
 * These tests drive the store with a minimal chainable Supabase stub that
 * serves KEYSET pages (`eq(repo)`, `gt(path, after)`, `order(path)`,
 * `limit(n)`) — loop r2, L-4: offsets let a concurrent delete hide a row.
 */

const PAGE = 1000;

type Row = { repo: "public" | "private"; path: string; content: string };
type PageCall = { repo: unknown; after: string | null; limit: number };

/** All rows for the package (public), in path order. */
function makeRows(count: number, repo: Row["repo"] = "public"): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      repo,
      path: `chapters/ch-${String(i).padStart(5, "0")}.md`,
      content: `content ${i}`,
    });
  }
  return rows;
}

/**
 * Minimal chainable stub: from().select().eq().eq().gt()?.order().limit(),
 * awaited to `{ data, error, count }` — count being the rows still ahead (as
 * PostgREST counts under the `gt` filter). `failOnPage` (0-based, across all
 * requests) makes that request return an error instead of rows.
 */
function makeStubClient(
  rows: Row[],
  opts: { failOnPage?: number; failMessage?: string } = {},
) {
  const pageCalls: PageCall[] = [];
  const orderCalls: string[] = [];
  const packageIds: unknown[] = [];
  let selected = "";
  let table = "";

  function builder() {
    let wantCount = false;
    let repo: unknown;
    let after: string | null = null;
    let limit = Number.POSITIVE_INFINITY;
    const run = () => {
      const page = pageCalls.length;
      pageCalls.push({ repo, after, limit });
      if (opts.failOnPage === page) return { data: null, error: { message: opts.failMessage ?? "boom" } };
      const rest = rows
        .filter((r) => r.repo === repo && (after === null || r.path > after))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return { data: rest.slice(0, limit), error: null, count: wantCount ? rest.length : null };
    };
    const b = {
      select(columns: string, o?: { count?: string }) {
        selected = columns;
        wantCount = o?.count === "exact";
        return b;
      },
      eq(column: string, value: unknown) {
        if (column === "package_id") packageIds.push(value);
        if (column === "repo") repo = value;
        return b;
      },
      gt(column: string, value: string) {
        expect(column).toBe("path");
        after = value;
        return b;
      },
      order(column: string) {
        orderCalls.push(column);
        return b;
      },
      limit(n: number) {
        limit = n;
        return b;
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve().then(run).then(res, rej);
      },
    };
    return b;
  }

  const client = {
    from(name: string) {
      table = name;
      return builder();
    },
  } as unknown as SupabaseClient;

  return {
    client,
    pageCalls,
    orderCalls,
    packageIds,
    get table() {
      return table;
    },
    get selected() {
      return selected;
    },
  };
}

describe("SupabaseSandboxStore.listFiles — pagination", () => {
  it("[P5.B.1.p] accumulates 2 full pages + a partial third, in order, by keyset", async () => {
    const rows = makeRows(PAGE * 2 + 500);
    const stub = makeStubClient(rows);
    const store = new SupabaseSandboxStore(stub.client);

    const files = await store.listFiles("pkg-1");

    expect(files).toHaveLength(PAGE * 2 + 500);
    expect(files).toEqual(rows);
    // Each repo walked by path: private (empty) once, then public in three
    // pages, each starting strictly after the last path read.
    expect(stub.pageCalls).toEqual([
      { repo: "private", after: null, limit: PAGE },
      { repo: "public", after: null, limit: PAGE },
      { repo: "public", after: rows[PAGE - 1]!.path, limit: PAGE },
      { repo: "public", after: rows[PAGE * 2 - 1]!.path, limit: PAGE },
    ]);
    expect(stub.table).toBe("sandbox_files");
    expect(stub.selected).toBe("repo, path, content");
    expect(stub.packageIds.every((v) => v === "pkg-1")).toBe(true);
    expect(stub.orderCalls.every((c) => c === "path")).toBe(true);
  });

  it("[P5.B.1.p] keeps the (repo, path) order across both repos", async () => {
    const rows = [...makeRows(3, "private"), ...makeRows(2, "public")];
    const stub = makeStubClient([...rows].reverse());
    const files = await new SupabaseSandboxStore(stub.client).listFiles("pkg-1");
    expect(files.map((f) => `${f.repo}:${f.path}`)).toEqual(rows.map((f) => `${f.repo}:${f.path}`).sort());
  });

  it("[P5.B.1.p] stops after a single short page per repo (small package)", async () => {
    const rows = makeRows(3);
    const stub = makeStubClient(rows);
    const store = new SupabaseSandboxStore(stub.client);

    const files = await store.listFiles("pkg-small");

    expect(files).toEqual(rows);
    expect(stub.pageCalls).toHaveLength(2); // one per repo
  });

  it("[P5.B.1.p] returns [] for a package with no files", async () => {
    const stub = makeStubClient([]);
    const store = new SupabaseSandboxStore(stub.client);

    const files = await store.listFiles("pkg-empty");

    expect(files).toEqual([]);
    expect(stub.pageCalls).toHaveLength(2);
  });

  it("[P5.B.1.p] needs no extra (empty) page when the total is a page multiple (the remaining count ends the walk)", async () => {
    const rows = makeRows(PAGE * 2);
    const stub = makeStubClient(rows);
    const store = new SupabaseSandboxStore(stub.client);

    const files = await store.listFiles("pkg-exact");

    expect(files).toHaveLength(PAGE * 2);
    expect(files).toEqual(rows);
    expect(stub.pageCalls.filter((c) => c.repo === "public")).toHaveLength(2);
  });

  it("[P5.B.1.p] throws the existing 'Could not load files' message when a page errors", async () => {
    const rows = makeRows(PAGE * 2 + 500);
    const stub = makeStubClient(rows, {
      failOnPage: 2,
      failMessage: "connection reset",
    });
    const store = new SupabaseSandboxStore(stub.client);

    await expect(store.listFiles("pkg-err")).rejects.toThrow(
      "Could not load files: connection reset",
    );
    expect(stub.pageCalls).toHaveLength(3);
  });
});

/**
 * replaceFileIf is the compare-and-swap the manifest owner rides on: the
 * comparison must happen IN Postgres (a WHERE clause), never as a read-then-
 * write in app code, or two tabs can still lose one another's change.
 */
type CasOpts = {
  insertError?: { code?: string; message: string };
  updateRows?: { path: string }[];
  updateError?: { message: string };
};

function makeCasClient(opts: CasOpts = {}) {
  const eqCalls: { column: string; value: unknown }[] = [];
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  let selected: string | null = null;
  let table = "";

  const builder = {
    insert(row: Record<string, unknown>) {
      inserted.push(row);
      return Promise.resolve({ data: null, error: opts.insertError ?? null });
    },
    update(patch: Record<string, unknown>) {
      updates.push(patch);
      return builder;
    },
    eq(column: string, value: unknown) {
      eqCalls.push({ column, value });
      return builder;
    },
    select(columns: string) {
      selected = columns;
      return Promise.resolve({
        data: opts.updateError ? null : (opts.updateRows ?? []),
        error: opts.updateError ?? null,
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
    eqCalls,
    inserted,
    updates,
    get selected() {
      return selected;
    },
    get table() {
      return table;
    },
  };
}

const FILE = {
  repo: "public" as const,
  path: "alembic.json",
  content: "new content",
};

describe("SupabaseSandboxStore.replaceFileIf — compare-and-swap", () => {
  it("UPDATEs keyed on package, repo, path AND the expected old content", async () => {
    const stub = makeCasClient({ updateRows: [{ path: "alembic.json" }] });
    const store = new SupabaseSandboxStore(stub.client);

    const outcome = await store.replaceFileIf("pkg-1", FILE, {
      content: "old content",
    });

    expect(outcome).toBe("ok");
    expect(stub.table).toBe("sandbox_files");
    expect(stub.updates).toEqual([{ content: "new content" }]);
    expect(stub.eqCalls).toEqual([
      { column: "package_id", value: "pkg-1" },
      { column: "repo", value: "public" },
      { column: "path", value: "alembic.json" },
      // By the stored digest, not the content (a content filter rides in the
      // request URL, which a large file overflows — loop r4).
      { column: "content_sha256", value: createHash("sha256").update("old content", "utf8").digest("hex") },
    ]);
    // .select() is what reveals how many rows the conditional UPDATE hit.
    expect(stub.selected).not.toBeNull();
  });

  it("reports 'conflict' when the conditional UPDATE affects no rows", async () => {
    const stub = makeCasClient({ updateRows: [] });
    const store = new SupabaseSandboxStore(stub.client);

    const outcome = await store.replaceFileIf("pkg-1", FILE, {
      content: "stale content",
    });

    expect(outcome).toBe("conflict");
  });

  it("throws (not 'conflict') on a real UPDATE error", async () => {
    const stub = makeCasClient({ updateError: { message: "connection reset" } });
    const store = new SupabaseSandboxStore(stub.client);

    await expect(
      store.replaceFileIf("pkg-1", FILE, { content: "old content" }),
    ).rejects.toThrow("Could not save files: connection reset");
  });

  it("create-only (expected null) INSERTs the row", async () => {
    const stub = makeCasClient();
    const store = new SupabaseSandboxStore(stub.client);

    const outcome = await store.replaceFileIf("pkg-1", FILE, null);

    expect(outcome).toBe("ok");
    expect(stub.inserted).toEqual([
      {
        package_id: "pkg-1",
        repo: "public",
        path: "alembic.json",
        content: "new content",
      },
    ]);
    expect(stub.updates).toEqual([]);
  });

  it("maps a unique violation on create-only to 'conflict'", async () => {
    const stub = makeCasClient({
      insertError: { code: "23505", message: "duplicate key value" },
    });
    const store = new SupabaseSandboxStore(stub.client);

    const outcome = await store.replaceFileIf("pkg-1", FILE, null);

    expect(outcome).toBe("conflict");
  });

  it("throws on any other INSERT error", async () => {
    const stub = makeCasClient({
      insertError: { code: "42501", message: "permission denied" },
    });
    const store = new SupabaseSandboxStore(stub.client);

    await expect(store.replaceFileIf("pkg-1", FILE, null)).rejects.toThrow(
      "Could not save files: permission denied",
    );
  });
});
