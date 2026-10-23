/**
 * Conformance + adversarial tests for the public-repo TEMPLATE
 * (`templates/public-repo/`), which ships into every course's public GitHub
 * repository and builds its site in GitHub Actions with nothing but
 * orz-markdown. Kept here because this package already depends on the same
 * orz-markdown the template installs from npm.
 *
 * P5.S.12.a — the checkout must not leave the job's GITHUB_TOKEN in
 *   `.git/config` (`persist-credentials: false`).
 * P5.S.12.b — a file include (`{{md …}}`) must never resolve a file inside a
 *   `.git` directory (or a `.git` file) under the repository root, whichever
 *   way the path is spelled.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const templatesDir = join(repoRoot, "templates");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Every GitHub Actions workflow file in the templates and in this repo. */
function workflowFiles(): string[] {
  const all = [...walk(templatesDir), ...walk(join(repoRoot, ".github"))];
  return all.filter((f) => /[\\/]\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/.test(f));
}

/** Split a workflow's steps into blocks (each `- ` item at a steps indent). */
function checkoutSteps(yaml: string): string[] {
  const lines = yaml.split("\n");
  const steps: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)-\s+(?:.*\s)?uses:\s*actions\/checkout@/.exec(lines[i]!);
    if (!m) continue;
    const indent = m[1]!.length;
    const block = [lines[i]!];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (l.trim() === "") continue;
      const lead = l.length - l.trimStart().length;
      if (lead <= indent) break;
      block.push(l);
    }
    steps.push(block.join("\n"));
  }
  return steps;
}

describe("public-repo template: workflows", () => {
  it("[P5.S.12.a] every actions/checkout step in every workflow sets persist-credentials: false", () => {
    const files = workflowFiles();
    expect(files.some((f) => f.endsWith("build-site.yml"))).toBe(true);
    let checkouts = 0;
    for (const f of files) {
      const yaml = readFileSync(f, "utf8");
      // Every `uses: actions/checkout` occurrence must be a step we parsed.
      const uses = yaml.match(/uses:\s*actions\/checkout@/g) ?? [];
      const steps = checkoutSteps(yaml);
      expect(steps.length, f).toBe(uses.length);
      for (const step of steps) {
        checkouts++;
        expect(step, `${f}\n${step}`).toMatch(/^\s+persist-credentials:\s*false\s*$/m);
      }
    }
    expect(checkouts).toBeGreaterThan(0);
  });
});

// ── P5.S.12.b: run the real template build against an adversarial repo ──

const SECRET = "AUTHORIZATION: basic c2VjcmV0LXRva2Vu-LEAK";

function orzMarkdownDir(): string {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve("orz-markdown/package.json"));
}

/** Build a throwaway "course repo" with the template's build and run it. */
function buildAdversarialRepo(chapter: string): string {
  const root = mkdtempSync(join(tmpdir(), "alembic-tpl-"));
  try {
    const build = join(root, ".alembic/build");
    cpSync(join(templatesDir, "public-repo/.alembic/build"), build, { recursive: true });
    mkdirSync(join(build, "node_modules"), { recursive: true });
    symlinkSync(orzMarkdownDir(), join(build, "node_modules/orz-markdown"), "dir");

    // What actions/checkout leaves behind, plus a submodule-style `.git` FILE.
    mkdirSync(join(root, ".git"), { recursive: true });
    writeFileSync(join(root, ".git/config"), `[http]\n\textraheader = ${SECRET}\n`);
    writeFileSync(join(root, ".git/HEAD"), `ref: refs/heads/${SECRET}\n`);
    mkdirSync(join(root, "sub"), { recursive: true });
    writeFileSync(join(root, "sub/.git"), `gitdir: ${SECRET}\n`);
    writeFileSync(join(root, "sub/part.md"), "Included part OK.\n");
    // A symlink inside the repo pointing into .git/.
    symlinkSync(join(root, ".git/config"), join(root, "sub/innocent.md"));

    mkdirSync(join(root, "study-guide"), { recursive: true });
    writeFileSync(join(root, "study-guide/01.md"), chapter);
    execFileSync(process.execPath, [join(build, "build-site.mjs")], { cwd: root, stdio: "pipe" });
    return readFileSync(join(root, "_site/index.html"), "utf8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("public-repo template: site build includes", () => {
  it("[P5.S.12.b] an include never resolves a file inside .git under markdownIncludeRoot", () => {
    const html = buildAdversarialRepo(
      [
        "# Chapter",
        "",
        // Targets resolve relative to the including file (study-guide/).
        "{{md ../sub/part.md}}",
        "",
        "{{md-include ../.git/config}}",
        "",
        "{{md ./../sub/../.git/HEAD}}",
        "",
        "{{md ../.git/./config}}",
        "",
        "{{md ../.GIT/config}}",
        "",
        "{{markdown ../sub/.git}}",
        "",
        "{{md ../sub/innocent.md}}",
        "",
      ].join("\n"),
    );
    // Positive control: ordinary includes still work.
    expect(html).toContain("Included part OK.");
    expect(html).not.toContain("LEAK");
    expect(html).not.toContain("c2VjcmV0LXRva2Vu");
  });
});
