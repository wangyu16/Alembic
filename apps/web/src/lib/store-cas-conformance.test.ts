/**
 * ADVERSARIAL SWEEP (T41) — store CONFORMANCE for the compare-and-swap
 * primitive that `updateManifest` is built on.
 *
 * Every manifest-concurrency test in `@alembic/package-ops` runs against
 * `MemoryPackageStore`. Those tests are only meaningful if the REAL store
 * implements `replaceFileIf` with the same semantics — otherwise the whole
 * "one manifest owner / no lost updates" guarantee
 * (docs/specs/storage-and-write-paths.md §3) is verified against a fiction.
 *
 * So this file runs one adversarial scenario table against BOTH
 * implementations: the memory store and `SupabaseSandboxStore` driven by a
 * table-backed fake Postgres (unique constraint on `(package_id, repo, path)`,
 * `UPDATE … WHERE content = <expected>` returning affected rows). Any divergence
 * is a finding, not a detail.
 */

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MemoryPackageStore,
  ManifestConflictError,
  MANIFEST_PATH,
  updateManifest,
  createSandboxPackage,
  type PackageStore,
} from "@alembic/package-ops";
import { parseManifest } from "@alembic/package-contract";
import { SupabaseSandboxStore } from "./sandbox-store";

/* -------------------------------------------------------------------------- *
 * A table-backed fake Postgres, faithful on the two behaviors the CAS needs:
 * the unique constraint (23505) and the content-conditional UPDATE.
 * -------------------------------------------------------------------------- */

interface Row {
  package_id: string;
  repo: "public" | "private";
  path: string;
  content: string;
}

function fakeSupabase(): SupabaseClient {
  const rows: Row[] = [];
  const keyOf = (r: { package_id: string; repo: string; path: string }) =>
    `${r.package_id}|${r.repo}|${r.path}`;

  function from() {
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let values: Partial<Row> = {};
    let payload: Row[] = [];
    const filters: Array<[string, unknown]> = [];
    const orders: string[] = [];
    let range: [number, number] | null = null;

    function matching(): Row[] {
      return rows.filter((r) =>
        filters.every(([col, val]) => (r as unknown as Record<string, unknown>)[col] === val),
      );
    }

    function execute(): { data: unknown; error: unknown } {
      switch (op) {
        case "insert": {
          for (const r of payload) {
            if (rows.some((existing) => keyOf(existing) === keyOf(r))) {
              return {
                data: null,
                error: { code: "23505", message: "duplicate key value" },
              };
            }
          }
          rows.push(...payload.map((r) => ({ ...r })));
          return { data: payload, error: null };
        }
        case "upsert": {
          for (const r of payload) {
            const i = rows.findIndex((existing) => keyOf(existing) === keyOf(r));
            if (i >= 0) rows[i] = { ...r };
            else rows.push({ ...r });
          }
          return { data: null, error: null };
        }
        case "update": {
          const hit = matching();
          for (const r of hit) Object.assign(r, values);
          return { data: hit.map((r) => ({ path: r.path })), error: null };
        }
        case "delete": {
          for (const r of matching()) rows.splice(rows.indexOf(r), 1);
          return { data: null, error: null };
        }
        case "select": {
          const hit = [...matching()].sort((a, b) => {
            for (const col of orders) {
              const av = String((a as unknown as Record<string, unknown>)[col]);
              const bv = String((b as unknown as Record<string, unknown>)[col]);
              if (av !== bv) return av < bv ? -1 : 1;
            }
            return 0;
          });
          const windowed = range ? hit.slice(range[0], range[1] + 1) : hit;
          return { data: windowed.map((r) => ({ ...r })), error: null };
        }
      }
    }

    const builder = {
      select() {
        if (op === "select") return builder;
        return builder; // `.select()` on an update = RETURNING
      },
      insert(r: Row | Row[]) {
        op = "insert";
        payload = Array.isArray(r) ? r : [r];
        return builder;
      },
      upsert(r: Row[]) {
        op = "upsert";
        payload = r;
        return builder;
      },
      update(v: Partial<Row>) {
        op = "update";
        values = v;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },
      order(column: string) {
        orders.push(column);
        return builder;
      },
      range(from: number, to: number) {
        range = [from, to];
        return Promise.resolve(execute());
      },
      maybeSingle() {
        const res = execute();
        const data = (res.data as unknown[]) ?? [];
        return Promise.resolve({ data: data[0] ?? null, error: res.error });
      },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
        return Promise.resolve(execute()).then(resolve);
      },
    };
    return builder;
  }

  return { from: () => from() } as unknown as SupabaseClient;
}

/* -------------------------------------------------------------------------- *
 * The scenario table, run against both stores
 * -------------------------------------------------------------------------- */

const IMPLS: Array<[name: string, make: () => PackageStore]> = [
  ["MemoryPackageStore", () => new MemoryPackageStore()],
  ["SupabaseSandboxStore (table-backed fake)", () => new SupabaseSandboxStore(fakeSupabase())],
];

async function seed(store: PackageStore) {
  const { packageId } = await createSandboxPackage(store, {
    ownerId: "user-1",
    title: "Thermochemistry",
    license: "CC-BY-4.0",
    now: () => new Date("2026-08-01T00:00:00.000Z"),
  });
  return packageId;
}

async function readRaw(store: PackageStore, packageId: string): Promise<string> {
  const files = await store.listFiles(packageId);
  return files.find((f) => f.repo === "public" && f.path === MANIFEST_PATH)!.content;
}

describe.each(IMPLS)("replaceFileIf CAS conformance — %s", (_name, make) => {
  it("stale expectation loses: the second writer gets 'conflict', not a silent overwrite", async () => {
    const store = make();
    const packageId = await seed(store);
    const original = await readRaw(store, packageId);

    // Writer A wins with the correct expectation.
    expect(
      await store.replaceFileIf(
        packageId,
        { repo: "public", path: MANIFEST_PATH, content: `${original}A` },
        { content: original },
      ),
    ).toBe("ok");

    // Writer B still holds the ORIGINAL content as its expectation.
    expect(
      await store.replaceFileIf(
        packageId,
        { repo: "public", path: MANIFEST_PATH, content: `${original}B` },
        { content: original },
      ),
    ).toBe("conflict");

    // A's write survived; B did not clobber it.
    expect(await readRaw(store, packageId)).toBe(`${original}A`);
  });

  it("create-only (expected === null) loses against an existing row", async () => {
    const store = make();
    const packageId = await seed(store);
    const original = await readRaw(store, packageId);

    expect(
      await store.replaceFileIf(
        packageId,
        { repo: "public", path: MANIFEST_PATH, content: "clobbered" },
        null,
      ),
    ).toBe("conflict");
    expect(await readRaw(store, packageId)).toBe(original);
  });

  it("create-only succeeds for a path that does not exist yet", async () => {
    const store = make();
    const packageId = await seed(store);

    expect(
      await store.replaceFileIf(
        packageId,
        { repo: "public", path: "study-guide/new.md", content: "# new\n" },
        null,
      ),
    ).toBe("ok");
    const files = await store.listFiles(packageId);
    expect(files.find((f) => f.path === "study-guide/new.md")?.content).toBe("# new\n");
  });

  it("a CAS on a MISSING file with a content expectation conflicts (never resurrects it)", async () => {
    const store = make();
    const packageId = await seed(store);

    expect(
      await store.replaceFileIf(
        packageId,
        { repo: "public", path: "study-guide/ghost.md", content: "x" },
        { content: "whatever" },
      ),
    ).toBe("conflict");
    expect(
      (await store.listFiles(packageId)).some((f) => f.path === "study-guide/ghost.md"),
    ).toBe(false);
  });

  it("the CAS is repo-scoped: a private file of the same path does not satisfy a public expectation", async () => {
    const store = make();
    const packageId = await seed(store);
    await store.putFiles(packageId, [
      { repo: "private", path: "private-instructor/x.md", content: "priv" },
    ]);

    expect(
      await store.replaceFileIf(
        packageId,
        { repo: "public", path: "private-instructor/x.md", content: "leak" },
        { content: "priv" },
      ),
    ).toBe("conflict");
  });

  it("updateManifest end-to-end: a foreign write between read and CAS does not lose an update", async () => {
    const store = make();
    const packageId = await seed(store);

    // Wrap so a foreign writer lands after the read but before the CAS.
    let reads = 0;
    const raced: PackageStore = {
      createPackage: (r, f) => store.createPackage(r, f),
      getPackage: (id) => store.getPackage(id),
      async listFiles(id) {
        const stale = await store.listFiles(id);
        if (++reads === 1) {
          await updateManifest(store, null, id, (m) => ({
            ...m,
            description: "Other tab.",
          }));
        }
        return stale.map((f) => ({ ...f }));
      },
      putFiles: (id, f) => store.putFiles(id, f),
      deleteFiles: (id, f) => store.deleteFiles(id, f),
      replaceFileIf: (id, f, e) => store.replaceFileIf(id, f, e),
    };

    const res = await updateManifest(raced, null, packageId, (m) => ({
      ...m,
      title: "This tab",
    }));

    expect(res.manifest.title).toBe("This tab");
    expect(res.manifest.description).toBe("Other tab.");
    const onDisk = parseManifest(JSON.parse(await readRaw(store, packageId)));
    expect(onDisk.title).toBe("This tab");
    expect(onDisk.description).toBe("Other tab.");
  });

  it("updateManifest is bounded on a store that always conflicts", async () => {
    const store = make();
    const packageId = await seed(store);
    let calls = 0;
    const hostile: PackageStore = {
      createPackage: (r, f) => store.createPackage(r, f),
      getPackage: (id) => store.getPackage(id),
      listFiles: (id) => store.listFiles(id),
      putFiles: (id, f) => store.putFiles(id, f),
      deleteFiles: (id, f) => store.deleteFiles(id, f),
      async replaceFileIf() {
        calls++;
        return "conflict";
      },
    };

    await expect(
      updateManifest(hostile, null, packageId, (m) => ({ ...m, title: "Nope" }), {
        maxAttempts: 5,
      }),
    ).rejects.toBeInstanceOf(ManifestConflictError);
    expect(calls).toBe(5);
  });
});

describe("EVIDENCE — the fake Postgres really does enforce the unique constraint", () => {
  it("a duplicate insert surfaces 23505, which is what turns create-only into 'conflict'", async () => {
    const client = fakeSupabase();
    const store = new SupabaseSandboxStore(client);
    const packageId = await seed(store);
    const first = await store.replaceFileIf(
      packageId,
      { repo: "public", path: "study-guide/a.md", content: "1" },
      null,
    );
    const second = await store.replaceFileIf(
      packageId,
      { repo: "public", path: "study-guide/a.md", content: "2" },
      null,
    );
    expect([first, second]).toEqual(["ok", "conflict"]);
  });
});
