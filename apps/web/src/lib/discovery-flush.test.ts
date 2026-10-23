/**
 * Correctness loop r2, M-D1 (P5.A.1.h): a large course's queued element
 * refresh is drained AFTER the write, in its own call, best-effort — and
 * every writer of the `packages.manifest` read cache does so.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { flushDiscovery } from "./discovery-flush";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("flushDiscovery", () => {
  it("[P5.A.1.h] asks the database to drain this package's queue, and never throws", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    await flushDiscovery({ rpc } as never, "pkg-1");
    expect(rpc).toHaveBeenCalledWith("discovery_flush_package", { p_package_id: "pkg-1" });
    const failing = { rpc: vi.fn(async () => { throw new Error("canceling statement due to statement timeout"); }) };
    await expect(flushDiscovery(failing as never, "pkg-1")).resolves.toBeUndefined();
    const missing = { rpc: vi.fn(async () => ({ data: null, error: { message: "function public.discovery_flush_package(p_package_id => text) does not exist" } })) };
    await expect(flushDiscovery(missing as never, "pkg-1")).resolves.toBeUndefined();
  });

  it("[P5.A.1.h] every writer of the packages.manifest read cache drains the discovery queue after it", () => {
    // reconcile-manifest.ts: its one caller (lib/github.ts reconcilePackage) flushes.
    const EXEMPT = new Set(["lib/reconcile-manifest.ts"]);
    const writers = sources(SRC).filter((f) =>
      /\.from\("packages"\)\s*\.update\(\{[^}]*\bmanifest\b/.test(readFileSync(f, "utf8")),
    );
    expect(writers.length).toBeGreaterThanOrEqual(6);
    const missing = writers
      .map((f) => relative(SRC, f))
      .filter((f) => !EXEMPT.has(f))
      .filter((f) => !readFileSync(join(SRC, f), "utf8").includes("flushDiscovery("));
    expect(missing).toEqual([]);
    expect(readFileSync(join(SRC, "lib/github.ts"), "utf8")).toMatch(
      /refreshManifestAfterReconcile\([^)]*\);\s*await flushDiscovery\(/,
    );
  });
});
