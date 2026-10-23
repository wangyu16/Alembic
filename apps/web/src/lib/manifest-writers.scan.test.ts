/**
 * Loop r2 (L-3, P5.B.1.w): `alembic.json` has ONE writer — `updateManifest`
 * in `packages/package-ops` (read → patch → commit when published →
 * compare-and-swap → register). No code outside package-ops may write it
 * through `putFiles`, which has no compare-and-swap and registers nothing.
 * Before r2, `mirrorManifestToSandbox` (lib/github.ts, after publish) did.
 *
 * Static scan over the web app, the worker and every package's `src/` except
 * package-ops (comments stripped, tests skipped): a file that calls
 * `putFiles(` must not name the manifest (`alembic.json` / `MANIFEST_PATH`)
 * anywhere in its code. File-level on purpose — it also catches a path built
 * a few lines above the call.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../..");

function srcDirs(): string[] {
  const pkgs = readdirSync(join(ROOT, "packages"))
    .filter((n) => n !== "package-ops")
    .map((n) => `packages/${n}/src`);
  return ["apps/web/src", "apps/worker/src", ...pkgs].filter((d) => {
    try {
      return statSync(join(ROOT, d)).isDirectory();
    } catch {
      return false;
    }
  });
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Does this source write the manifest through `putFiles`? */
function writesManifestViaPutFiles(src: string): boolean {
  const code = stripComments(src);
  return /\bputFiles\s*\(/.test(code) && /alembic\.json|\bMANIFEST_PATH\b/.test(code);
}

describe("alembic.json has one writer (loop r2, L-3)", () => {
  it("[P5.B.1.w] no code outside package-ops writes alembic.json via putFiles", () => {
    const offenders = srcDirs()
      .flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => writesManifestViaPutFiles(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("[P5.B.1.w] the scan recognises a direct write and ignores comments", () => {
    expect(
      writesManifestViaPutFiles(
        `await store.putFiles(id, [{ repo: "public", path: "alembic.json", content }]);`,
      ),
    ).toBe(true);
    expect(
      writesManifestViaPutFiles(`const p = MANIFEST_PATH;\nawait store.putFiles(id, [{ repo: "public", path: p, content }]);`),
    ).toBe(true);
    expect(writesManifestViaPutFiles(`// putFiles("alembic.json")\nawait store.putFiles(id, files);`)).toBe(false);
    expect(writesManifestViaPutFiles(`const raw = await store.readFile(id, "public", "alembic.json");`)).toBe(false);
  });
});
