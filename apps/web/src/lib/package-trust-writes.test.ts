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
