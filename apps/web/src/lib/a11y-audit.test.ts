/**
 * Security loop r2, M2 residual (claim P5.S.3.g): the server's accessibility
 * check — whose result Discover trusts — audits the PUBLISHED bytes of a
 * published course (its recorded public repository at head), not the
 * owner-writable `sandbox_files` mirror. Repro (round-2 audit): an owner
 * writes a clean copy of a failing chapter into the mirror through the API,
 * re-runs the check, and "pass" was recorded for a course that still fails.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseManifest } from "@alembic/package-contract";
import type { PackageRecord, PackageStore } from "@alembic/package-ops";

vi.mock("server-only", () => ({}));

import { a11yAuditSource, auditPackageA11y } from "./a11y-audit";

const MANIFEST = JSON.stringify({
  schemaVersion: 2,
  packageId: "pkg-1",
  title: "T",
  license: "CC-BY-4.0",
  createdAt: "2026-08-28T00:00:00.000Z",
});
const CLEAN = "## Intro {#b-aaaaaaaa}\n\nPlain prose with nothing to flag.\n";
const FAILING = "## Intro {#b-aaaaaaaa}\n\n![ ](figure.png)\n";

function record(over: Partial<PackageRecord> = {}): PackageRecord {
  return {
    packageId: "pkg-1",
    ownerId: "u",
    title: "T",
    storage: "github",
    manifest: parseManifest(JSON.parse(MANIFEST)),
    repos: { public: { owner: "prof", name: "thermo" }, private: null },
    ...over,
  };
}

/** The owner-writable mirror: a CLEAN copy. */
function mirror(rec: PackageRecord): PackageStore {
  return {
    getPackage: async () => rec,
    readFile: async (_id: string, _repo: string, path: string) => (path === "alembic.json" ? MANIFEST : CLEAN),
  } as unknown as PackageStore;
}

/** The published repository: still FAILING. */
function published(paths: string[]) {
  return {
    getBranchHead: async () => ({ commitSha: "head-1" }),
    getFileAtRef: async (coords: { owner: string; repo: string }, path: string, ref: string) => {
      paths.push(`${coords.owner}/${coords.repo}@${ref}:${path}`);
      return path === "alembic.json" ? MANIFEST : FAILING;
    },
  };
}

describe("P5.S.3.g the trusted accessibility result describes the published bytes", () => {
  it("[P5.S.3.g] a published course is audited from its recorded repository at head, not the clean mirror", async () => {
    const rec = record();
    const reads: string[] = [];
    const source = await a11yAuditSource(mirror(rec), rec, async () => published(reads));
    expect(source.ok).toBe(true);
    if (!source.ok) throw new Error("unreachable");
    expect(source.published).toBe(true);
    const counts = await auditPackageA11y(source.store, "pkg-1");
    expect(counts.errorCount).toBeGreaterThan(0);
    expect(reads.every((r) => r.startsWith("prof/thermo@head-1:"))).toBe(true);
    // Control: the mirror alone would have passed.
    expect((await auditPackageA11y(mirror(rec), "pkg-1")).errorCount).toBe(0);
  });

  it("[P5.S.3.g] a published course whose repository cannot be read is refused, never audited from the mirror", async () => {
    const rec = record();
    expect((await a11yAuditSource(mirror(rec), rec, async () => null)).ok).toBe(false);
    const unrecorded = record({ repos: { public: null, private: null } });
    expect((await a11yAuditSource(mirror(unrecorded), unrecorded, async () => published([]))).ok).toBe(false);
  });

  it("[P5.S.3.g] the check action audits through that source and records only a published audit", () => {
    const src = readFileSync(resolve(__dirname, "../app/workspace/[packageId]/a11y-actions.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function recheckA11yAction"), src.indexOf("export interface SuggestFixResult"));
    expect(body).toMatch(/a11yAuditSource\(/);
    expect(body).toMatch(/auditPackageA11y\(source\.store/);
    expect(body).not.toMatch(/loadStudyGuide\(store/);
    expect(body).toMatch(/if \(source\.published\) \{\s*await packageTrustWriter\(createServiceClient\)\.recordA11yCheck/);
  });
});
