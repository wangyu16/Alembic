/**
 * Security loop r2, NEW-1 — the class (P5.S.3.e): no server code reads a
 * package's repository from the owner-writable manifest (`manifest.publicRepo`
 * / `privateRepo`). Every read or write of a published package's repository
 * uses the repository the publish path recorded (`packages.public_repo` /
 * `private_repo`, via `lib/recorded-repo.ts`).
 *
 * Static scan over the web app, the worker and every package's `src/`
 * (comments stripped): any `.publicRepo` / `.privateRepo` property read,
 * `["publicRepo"]` index, or destructuring of those fields fails here unless
 * its file is in ALLOWED with the reason the value read is NOT the manifest
 * field of a stored package. Writing the fields (object-literal keys, e.g. the
 * publish action stamping the repos the GitHub App just created into the
 * course's own alembic.json) is not a read and is not matched.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../..");
const SCAN_DIRS = ["apps/web/src", "apps/worker/src", ...packageSrcDirs()];

function packageSrcDirs(): string[] {
  const dir = join(ROOT, "packages");
  return readdirSync(dir)
    .map((n) => `packages/${n}/src`)
    .filter((d) => {
      try {
        return statSync(join(ROOT, d)).isDirectory();
      } catch {
        return false;
      }
    });
}

/**
 * The only files that may read a `publicRepo` / `privateRepo` property — each
 * reads something that is NOT a stored package's manifest field.
 */
const ALLOWED: Record<string, string> = {
  // The publish action's own value: the repos the GitHub App just created
  // under the educator's installation, being RECORDED (the trust write).
  "apps/web/src/lib/package-trust-writes.ts": "records v.publicRepo / v.privateRepo passed by the publish action",
  // Whole-package upload: `input.target` is built by the caller from the
  // RECORDED repos (populate-package route → recordedPublicRepo/PrivateRepo).
  "packages/package-ops/src/populate-package.ts": "copies input.target (the recorded repos) into the plan",
  // githubCommitter destructures its OWN args; committerFor passes the
  // recorded repos (recordedPublicRepo / recordedPrivateRepo).
  "apps/web/src/lib/committer.ts": "destructures githubCommitter's args (built from the recorded repos)",
  // Test-only PGlite harness (never imported by app code): seeds manifests.
  "apps/web/src/lib/discovery-pglite.ts": "test harness building seed manifests",
  // Adaptation STRIPS the source's repo pair from the copy's manifest
  // (destructured only to be dropped; the copy is a new trial course).
  "packages/package-ops/src/adaptation.ts": "destructures publicRepo/privateRepo out of the copy to drop them",
  "packages/package-contract/src/manifest-v3.ts": "toPublicManifest destructures publicRepo/privateRepo out to drop them from the public manifest (v3, R16)",
};

const READ_PATTERNS: RegExp[] = [
  /\??\.\s*(?:publicRepo|privateRepo)\b/,
  /\[\s*["'](?:publicRepo|privateRepo)["']\s*\]/,
  /\{[^{}]*\b(?:publicRepo|privateRepo)\b[^{}]*\}\s*=/,
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function offending(src: string): string[] {
  const out: string[] = [];
  const code = stripComments(src);
  for (const line of code.split("\n")) {
    if (READ_PATTERNS.some((p) => p.test(line))) out.push(line.trim());
  }
  // Multi-line destructuring `{\n publicRepo,\n ... } = x.manifest`.
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=/g)) {
    if (/\b(?:publicRepo|privateRepo)\b/.test(m[1]!) && m[1]!.includes("\n")) out.push(m[0].replace(/\s+/g, " "));
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("P5.S.3.e no server code reads the repository from the owner-writable manifest", () => {
  it("[P5.S.3.e] every publicRepo/privateRepo read outside the allowed files is refused", () => {
    const found: string[] = [];
    for (const d of SCAN_DIRS) {
      for (const f of walk(join(ROOT, d))) {
        const rel = relative(ROOT, f).split("\\").join("/");
        if (rel in ALLOWED) continue;
        for (const hit of offending(readFileSync(f, "utf8"))) found.push(`${rel}: ${hit}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("[P5.S.3.e] the allowed files exist and still need their exemption", () => {
    for (const rel of Object.keys(ALLOWED)) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(offending(src).length, rel).toBeGreaterThan(0);
    }
  });

  it("[P5.S.3.e] the scan sees every read shape (self-check)", () => {
    expect(offending(`const r = record.manifest.publicRepo;`)).toHaveLength(1);
    expect(offending(`const r = (pkg.manifest as X)?.publicRepo;`)).toHaveLength(1);
    expect(offending(`const r = m["privateRepo"];`)).toHaveLength(1);
    expect(offending(`const { publicRepo } = record.manifest;`)).toHaveLength(1);
    expect(offending(`const {\n  title,\n  privateRepo,\n} = manifest;`).length).toBeGreaterThan(0);
    // Writes and comments are not reads.
    expect(offending(`const m = { ...base, publicRepo: { owner, name } };`)).toEqual([]);
    expect(offending(`// never manifest.publicRepo\n/* manifest.privateRepo */`)).toEqual([]);
  });
});
