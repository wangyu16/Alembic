import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackageManifest } from "@alembic/package-contract";
import { packageTrustWriter } from "./package-trust-writes";

interface Call {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

function fakeService(rows: unknown[] | null = [{ id: "pkg-1" }], error: unknown = null) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, patch: {}, filters: [] };
      calls.push(call);
      const q = {
        update(patch: Record<string, unknown>) {
          call.patch = patch;
          return q;
        },
        eq(col: string, v: unknown) {
          call.filters.push([col, v]);
          return q;
        },
        select() {
          return Promise.resolve({ data: rows, error });
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const manifest = { title: "T" } as unknown as PackageManifest;

describe("M2 the trust columns are written by the service client, scoped to the owner", () => {
  it("[P5.S.3.a] publish, archive, restore and the a11y record filter on the package AND its owner", async () => {
    const { client, calls } = fakeService();
    const w = packageTrustWriter(() => client);
    expect(
      await w.recordPublished("pkg-1", "user-1", {
        publicRepo: { owner: "edu", name: "c-oer" },
        privateRepo: { owner: "edu", name: "c-private" },
        manifest,
      }),
    ).toEqual({ ok: true });
    await w.setArchived("pkg-1", "user-1", "2026-10-23T00:00:00.000Z");
    await w.setArchived("pkg-1", "user-1", null);
    await w.recordA11yCheck("pkg-1", "user-1", { status: "pass", checkedAt: "2026-10-23T00:00:00.000Z" });
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(c.table).toBe("packages");
      expect(c.filters).toEqual([
        ["id", "pkg-1"],
        ["owner_id", "user-1"],
      ]);
    }
    expect(calls[0]!.patch).toEqual({
      storage: "github",
      public_repo: { owner: "edu", name: "c-oer" },
      private_repo: { owner: "edu", name: "c-private" },
      manifest,
    });
    expect(calls[1]!.patch).toEqual({ archived_at: "2026-10-23T00:00:00.000Z" });
    expect(calls[2]!.patch).toEqual({ archived_at: null });
    expect(calls[3]!.patch).toEqual({ a11y_status: "pass", a11y_checked_at: "2026-10-23T00:00:00.000Z" });
  });

  it("[P5.S.3.a] someone else's package (no row matched), a missing service key or an error is not success", async () => {
    expect(await packageTrustWriter(() => fakeService([]).client).setArchived("p", "u", null)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await packageTrustWriter(() => null).setArchived("p", "u", null)).toEqual({
      ok: false,
      reason: "no-service-client",
    });
    expect(
      await packageTrustWriter(() => fakeService(null, { message: "x" }).client).setArchived("p", "u", null),
    ).toEqual({ ok: false, reason: "failed" });
  });
});

describe("NEW-5 the listing row is written by the server, scoped to the owner", () => {
  function listingService(owned: boolean) {
    const calls: Array<{ table: string; op: string; arg?: unknown; filters: Array<[string, unknown]> }> = [];
    const client = {
      from(table: string) {
        const call = { table, op: "", arg: undefined as unknown, filters: [] as Array<[string, unknown]> };
        calls.push(call);
        const q = {
          select() {
            call.op = "select";
            return q;
          },
          eq(col: string, v: unknown) {
            call.filters.push([col, v]);
            return q;
          },
          maybeSingle: async () => ({ data: owned ? { id: "pkg-1" } : null, error: null }),
          upsert: async (row: unknown, opts: unknown) => {
            call.op = "upsert";
            call.arg = { row, opts };
            return { error: null };
          },
        };
        return q;
      },
    };
    return { client: client as unknown as SupabaseClient, calls };
  }
  const snapshot = {
    title: "T",
    description: "",
    keywords: [],
    discipline: "chemistry",
    license: "CC-BY-4.0",
    public_repo_url: "https://github.com/edu/c-oer",
    site_url: "https://edu.github.io/c-oer/",
  };

  it("[P5.S.1.f] recordListing proves the package is the owner's, then upserts naming that owner", async () => {
    const { client, calls } = listingService(true);
    expect(await packageTrustWriter(() => client).recordListing("pkg-1", "user-1", snapshot)).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ table: "packages", filters: [["id", "pkg-1"], ["owner_id", "user-1"]] });
    expect(calls[1]).toMatchObject({
      table: "portal_registrations",
      op: "upsert",
      arg: { row: { package_id: "pkg-1", owner_id: "user-1", ...snapshot }, opts: { onConflict: "package_id" } },
    });
  });

  it("[P5.S.1.f] someone else's package or no service key writes nothing", async () => {
    const other = listingService(false);
    expect(await packageTrustWriter(() => other.client).recordListing("pkg-1", "user-2", snapshot)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(other.calls.some((c) => c.op === "upsert")).toBe(false);
    expect(await packageTrustWriter(() => null).recordListing("pkg-1", "user-1", snapshot)).toEqual({
      ok: false,
      reason: "no-service-client",
    });
  });

  it("[P5.S.1.f] registerPackageAction lists through recordListing, never through the session", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../app/workspace/[packageId]/portal-actions.ts"), "utf8");
    const register = src.slice(src.indexOf("export async function registerPackageAction"), src.indexOf("export async function unregisterPackageAction"));
    expect(register).toMatch(/packageTrustWriter\(createServiceClient\)\.recordListing\(packageId, user\.id,/);
    expect(register).not.toMatch(/from\("portal_registrations"\)/);
    // The gates run before the write.
    expect(register.indexOf("releaseGates(")).toBeLessThan(register.indexOf("recordListing("));
    expect(register.indexOf("if (!attestation)")).toBeLessThan(register.indexOf("recordListing("));
  });
});
