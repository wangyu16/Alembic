/**
 * Loop r2 (L-3, P5.B.1.w): `alembic.json` has ONE writer — `updateManifest`
 * in `packages/package-ops` (read → patch → commit when published →
 * compare-and-swap → register). No code outside package-ops may write it
 * through `putFiles`, which has no compare-and-swap and registers nothing.
 * Before r2, `mirrorManifestToSandbox` (lib/github.ts, after publish) did.
 *
 * Static scan over the web app, the worker and every package's `src/` except
 * package-ops (comments stripped, tests skipped): a file that calls
 * `putFiles(` (or, since loop r3, `replaceFileIf(`) must not name the manifest
 * anywhere in its code — in any spelling that resolves to `alembic.json`.
 * File-level on purpose — it also catches a path built a few lines above the
 * call.
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

/* ── Constant resolution (loop r3, P5.B.1.y) ─────────────────────────────────
 * The r2 scan only saw the literal `alembic.json` and the token
 * `MANIFEST_PATH`. A writer could still name the manifest through any other
 * constant (`const DETAILS = "alembic.json"`, an aliased import, a constant
 * exported from another module), a concatenation (`"alembic" + ".json"`) or a
 * template string (`${base}.json`). This resolves string constants across the
 * scanned sources AND package-ops (which owns `MANIFEST_PATH`) to a small
 * fixpoint and folds every string expression it can, so any spelling that
 * evaluates to "alembic.json" counts. */

const MANIFEST = "alembic.json";
const IDENT = String.raw`[A-Za-z_$][\w$]*`;
const STR_RE = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60(?:[^\x60\\]|\\.)*\x60`;
/** A string expression: literals / templates / identifiers joined by `+`. */
const EXPR_RE = new RegExp(
  String.raw`(?:${STR_RE}|${IDENT})(?:\s*\+\s*(?:${STR_RE}|${IDENT}))*`,
  "g",
);

type Consts = Map<string, Set<string>>;

function addConst(map: Consts, name: string, value: string): boolean {
  const set = map.get(name) ?? new Set<string>();
  if (set.has(value)) return false;
  set.add(value);
  map.set(name, set);
  return true;
}

/** Every value a string expression can take, or [] if it is not one we can fold. */
function evaluate(expr: string, scope: (name: string) => Set<string> | undefined): string[] {
  const parts = expr.split(/\s*\+\s*(?=(?:["'\x60]|[A-Za-z_$]))/);
  let acc: string[] = [""];
  for (const raw of parts) {
    const part = raw.trim();
    let values: string[];
    if (/^["']/.test(part)) {
      values = [part.slice(1, -1).replace(/\\(.)/g, "$1")];
    } else if (part.startsWith("\x60")) {
      // Template: substitute each ${…} with a literal or a known constant.
      let outs = [""];
      const body = part.slice(1, -1);
      const re = /\$\{([^}]*)\}/g;
      let last = 0;
      for (let m = re.exec(body); m; m = re.exec(body)) {
        const lit = body.slice(last, m.index);
        const inner = evaluate(m[1]!.trim(), scope);
        if (inner.length === 0) return [];
        outs = outs.flatMap((o) => inner.map((v) => o + lit + v));
        last = m.index + m[0].length;
      }
      values = outs.map((o) => o + body.slice(last));
    } else if (new RegExp(`^${IDENT}$`).test(part)) {
      const known = scope(part);
      if (!known) return [];
      values = [...known];
    } else {
      return [];
    }
    acc = acc.flatMap((a) => values.map((v) => a + v)).slice(0, 64);
  }
  return acc;
}

const CONST_DECL = new RegExp(
  String.raw`\b(export\s+)?(?:const|let|var)\s+(${IDENT})\s*(?::[^=;\n]+)?=\s*([^;\n]+?)\s*(?:as\s+const\s*)?(?:;|\n)`,
  "g",
);
const IMPORT_ALIAS = new RegExp(String.raw`\b(${IDENT})\s+as\s+(${IDENT})\b`, "g");

interface Source {
  path: string;
  code: string;
  local: Consts;
}

/** Resolve string constants: exported ones globally, the rest per file. */
function resolveConstants(sources: Source[]): Consts {
  const global: Consts = new Map();
  for (let changed = true, round = 0; changed && round < 8; round++) {
    changed = false;
    for (const src of sources) {
      const scope = (n: string) => src.local.get(n) ?? global.get(n);
      for (const m of src.code.matchAll(IMPORT_ALIAS)) {
        for (const v of global.get(m[1]!) ?? []) changed = addConst(src.local, m[2]!, v) || changed;
      }
      for (const m of src.code.matchAll(CONST_DECL)) {
        for (const v of evaluate(m[3]!, scope)) {
          changed = addConst(src.local, m[2]!, v) || changed;
          if (m[1]) changed = addConst(global, m[2]!, v) || changed;
        }
      }
    }
  }
  return global;
}

/** Does this (comment-stripped) code name the manifest in any spelling? */
function namesManifest(code: string, scope: (name: string) => Set<string> | undefined): boolean {
  if (/alembic\.json/.test(code)) return true;
  for (const m of code.matchAll(EXPR_RE)) {
    if (evaluate(m[0], scope).includes(MANIFEST)) return true;
  }
  return false;
}

/** The raw store writers that bypass `updateManifest`'s compare-and-swap. */
const RAW_WRITER = /\b(?:putFiles|replaceFileIf)\s*\(/;

/** Does this source write the manifest through a raw store writer? `extra`
 *  are other sources whose exported constants it may import. */
function writesManifestViaPutFiles(src: string, extra: string[] = []): boolean {
  const code = stripComments(src);
  if (!RAW_WRITER.test(code)) return false;
  const me: Source = { path: "<self>", code, local: new Map() };
  const others = extra.map((c, i) => ({ path: String(i), code: stripComments(c), local: new Map() }));
  const global = resolveConstants([me, ...others, ...packageOpsSources()]);
  addConst(global, "MANIFEST_PATH", MANIFEST); // the owner's constant, by name
  return namesManifest(code, (n) => me.local.get(n) ?? global.get(n));
}

let opsCache: Source[] | null = null;
function packageOpsSources(): Source[] {
  opsCache ??= walk(join(ROOT, "packages/package-ops/src")).map((p) => ({
    path: p,
    code: stripComments(readFileSync(p, "utf8")),
    local: new Map(),
  }));
  return opsCache.map((s) => ({ ...s, local: new Map() }));
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

describe("alembic.json has one writer, in any spelling (loop r3, L3-2)", () => {
  const write = (path: string) =>
    `await store.putFiles(id, [{ repo: "public", path: ${path}, content }]);`;

  it("[P5.B.1.y] the scan resolves constants, aliases, concatenations and template strings to alembic.json", () => {
    // A local constant under another name.
    expect(writesManifestViaPutFiles(`const DETAILS = "alembic.json";\n${write("DETAILS")}`)).toBe(true);
    // A concatenation, inline or through constants.
    expect(writesManifestViaPutFiles(write(`"alembic" + ".json"`))).toBe(true);
    expect(writesManifestViaPutFiles(`const base = "alembic";\nconst p = base + ".json";\n${write("p")}`)).toBe(true);
    // Template strings.
    expect(writesManifestViaPutFiles(`const base = 'alembic';\n${write("`${base}.json`")}`)).toBe(true);
    expect(writesManifestViaPutFiles(`const ext = "json";\n${write("`alembic.${ext}`")}`)).toBe(true);
    // A constant exported by another module, imported under an alias.
    expect(
      writesManifestViaPutFiles(
        `import { COURSE_FILE as F } from "./paths";\n${write("F")}`,
        [`export const COURSE_FILE = "alembic" + ".json";`],
      ),
    ).toBe(true);
    // package-ops' own constant, aliased.
    expect(writesManifestViaPutFiles(`import { MANIFEST_FILE as M } from "@alembic/package-ops";\n${write("M")}`)).toBe(true);
    // The compare-and-swap writer is a raw writer too.
    expect(
      writesManifestViaPutFiles(`const p = "alembic.json";\nawait store.replaceFileIf(id, { repo: "public", path: p, content }, { content: raw });`),
    ).toBe(true);
  });

  it("[P5.B.1.y] the scan does not flag other files written next to a manifest read", () => {
    expect(writesManifestViaPutFiles(`const base = "alembic";\n${write("`${base}.md`")}`)).toBe(false);
    expect(writesManifestViaPutFiles(`const p = "study-guide/" + slug + ".md";\n${write("p")}`)).toBe(false);
    expect(writesManifestViaPutFiles(`const DETAILS = "alembic" + ".json";\nconst raw = await store.readFile(id, "public", DETAILS);`)).toBe(false);
  });
});

describe("the one other commit of alembic.json is the first publish (loop r4, P5.B.1.y)", () => {
  /** Calls that commit to a repository directly, around the committer. */
  const RAW_COMMIT = /\b(?:commitFiles|createCommitOnBranch|publishToBranch)\s*\(/;
  it("[P5.B.1.y] outside package-ops, only the first publish commits alembic.json directly — before the course is published, into its new repository", () => {
    const committing = srcDirs()
      .flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => !f.includes("packages/github-bridge/")) // the transport itself
      .filter((f) => {
        const code = stripComments(readFileSync(f, "utf8"));
        if (!RAW_COMMIT.test(code)) return false;
        const me: Source = { path: f, code, local: new Map() };
        const global = resolveConstants([me, ...packageOpsSources()]);
        addConst(global, "MANIFEST_PATH", MANIFEST);
        return namesManifest(code, (n) => me.local.get(n) ?? global.get(n));
      })
      .map((f) => relative(ROOT, f));
    expect(committing).toEqual(["apps/web/src/app/workspace/[packageId]/github-actions.ts"]);
    // …and there, only in the publish commit, built before the course is recorded as published.
    const src = readFileSync(join(ROOT, committing[0]!), "utf8");
    const publishCommit = src.indexOf('summary: "Publish from Alembic", changes: publicChanges');
    expect(publishCommit).toBeGreaterThan(-1);
    expect(publishCommit).toBeLessThan(src.indexOf("recordPublished(packageId"));
  });
});

