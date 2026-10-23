import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSandboxPackage,
  MANIFEST_PATH,
  MemoryPackageStore,
  reconcilePublicRepo,
  type RepoReader,
} from "@alembic/package-ops";
import { parseManifest } from "@alembic/package-contract";
import { refreshManifestAfterReconcile } from "./reconcile-manifest";

function fakeSupabase() {
  const updates: Array<{ table: string; values: Record<string, unknown>; id: unknown }> = [];
  const client = {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          updates.push({ table, values, id });
          return { error: null };
        },
      }),
    }),
  } as unknown as Pick<SupabaseClient, "from">;
  return { client, updates };
}

function reader(changed: Array<{ path: string; status: "added" | "modified" | "removed" }>, files: Record<string, string>): RepoReader {
  return {
    getHeadSha: async () => "sha-9",
    listChangedPaths: async () => changed,
    readFileAtRef: async (p) => files[p] ?? null,
  };
}

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, { ownerId: "u", title: "Thermo", license: "CC-BY-4.0" });
  const manifest = parseManifest(JSON.parse((await store.readFile(packageId, "public", MANIFEST_PATH))!));
  return { store, packageId, manifest };
}

describe("reconcile → packages.manifest", () => {
  it("[P5.B.3.e] a reconcile that absorbs a licence change on GitHub refreshes packages.manifest from the write path's manifest", async () => {
    const { store, packageId, manifest } = await seeded();
    const out = await reconcilePublicRepo(store, packageId, {
      lastSyncedSha: "sha-1",
      reader: reader([{ path: MANIFEST_PATH, status: "modified" }], {
        [MANIFEST_PATH]: JSON.stringify({ ...manifest, license: "CC0-1.0" }),
      }),
    });
    const { client, updates } = fakeSupabase();
    expect(await refreshManifestAfterReconcile(client, packageId, out)).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ table: "packages", id: packageId });
    expect((updates[0]!.values["manifest"] as { license: string }).license).toBe("CC0-1.0");
  });

  it("[P5.B.3.e] an invalid foreign alembic.json never reaches packages.manifest", async () => {
    const { store, packageId } = await seeded();
    const out = await reconcilePublicRepo(store, packageId, {
      lastSyncedSha: "sha-1",
      reader: reader([{ path: MANIFEST_PATH, status: "modified" }], { [MANIFEST_PATH]: '{"license":42}' }),
    });
    expect(out.status).toBe("quarantined");
    const { client, updates } = fakeSupabase();
    expect(await refreshManifestAfterReconcile(client, packageId, out)).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("[P5.B.3.e] the web reconcile refreshes the column through this helper", () => {
    const src = readFileSync(new URL("./github.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function reconcilePackage("));
    expect(body.slice(0, body.indexOf("\n}\n"))).toMatch(/refreshManifestAfterReconcile\(supabase, packageId, outcome\)/);
  });
});
