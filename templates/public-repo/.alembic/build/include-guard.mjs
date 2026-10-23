/**
 * The ONE gate for file includes in the standalone site build.
 *
 * orz-markdown keeps `{{md part.md}}` inside `markdownIncludeRoot`; this adds
 * the rule it cannot know about: nothing under a `.git` directory — and no
 * `.git` file (a submodule/worktree pointer) — is ever read, however the path
 * is spelled (`.git/config`, `./sub/../.git/HEAD`, `.GIT/config`, a symlink
 * into `.git/`). In a CI checkout `.git/config` can carry credentials; a
 * course page must never be able to publish them.
 *
 * Node built-ins only (no orz-markdown import), so it is testable on its own.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** True when any segment of a root-relative path is `.git` (any case). */
function touchesGit(rel) {
  return rel.split(/[\\/]+/).some((seg) => seg.toLowerCase() === ".git");
}

/** A path relative to `root`, or null when it is the root or leaves it. */
function inside(root, p) {
  const rel = relative(root, p);
  if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || rel.startsWith("../") || isAbsolute(rel))
    return null;
  return rel;
}

/**
 * The render env for one file: includes resolve relative to `basePath`, only
 * inside `root`, never into `.git`. Pass to `md.render(source, env)`.
 */
export function includeEnv(root, basePath) {
  const lexicalRoot = resolve(root);
  let realRoot;
  try {
    realRoot = realpathSync(lexicalRoot);
  } catch {
    realRoot = lexicalRoot;
  }
  return {
    markdownBasePath: basePath,
    markdownIncludeRoot: lexicalRoot,
    readFile(target) {
      try {
        const lexical = inside(lexicalRoot, resolve(target));
        if (lexical === null || touchesGit(lexical)) return null;
        // Follow symlinks: the REAL file must also be inside the root and
        // outside `.git`.
        const real = realpathSync(target);
        const rel = inside(realRoot, real);
        if (rel === null || touchesGit(rel)) return null;
        if (!statSync(real).isFile()) return null;
        return readFileSync(real, "utf8");
      } catch {
        return null;
      }
    },
  };
}
