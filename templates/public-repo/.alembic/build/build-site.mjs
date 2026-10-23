#!/usr/bin/env node
/**
 * Standalone static-site build for an Alembic OER package.
 *
 * Depends ONLY on orz-markdown (public npm) — it rebuilds the public site
 * without Alembic, so this repository is usable as a plain Git repo. Run from
 * the repository root:
 *
 *   npm --prefix .alembic/build install
 *   node .alembic/build/build-site.mjs
 *
 * Output goes to ./_site (index.html + practice/*.html), ready for any
 * static host or the committed GitHub Actions workflow.
 *
 * Layout read: every chapter's study guide (`study-guide/*.md`, in name
 * order) on the home page, and each chapter's practice questions
 * (`practice/*.md`) as its own page. Packages from before chapters kept
 * worksheets in `materials/worksheets/*.md`; those are listed too.
 *
 * File includes (`{{md part.md}}`) resolve relative to the including file and
 * only inside this repository (orz-markdown ≥ 2.0 `markdownIncludeRoot`), so
 * a build never reads a file outside the checkout.
 */
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync,
} from "node:fs";
import { join, basename, dirname } from "node:path";
import { createRequire } from "node:module";
import { md } from "orz-markdown";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const OUT = join(ROOT, "_site");
const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.35/dist/katex.min.css";

// orz-markdown ships its themes; inline the dark-elegant theme + its common base.
function themeCss() {
  const darkPath = require.resolve("orz-markdown/themes/dark-elegant-1.css");
  const dir = darkPath.slice(0, darkPath.lastIndexOf("/"));
  const common = readFileSync(join(dir, "common.css"), "utf8");
  const dark = readFileSync(darkPath, "utf8");
  return dark.replace(/@import\s+['"]\.\/common\.css['"];/, common);
}
const THEME = themeCss();

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function doc(title, bodyHtml) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${KATEX}">
<style>${THEME}</style></head>
<body><div class="markdown-body">
${bodyHtml}
</div></body></html>
`;
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
// File includes stay inside the repository; a fresh env per render.
const render = (path) =>
  md.render(read(path), { markdownBasePath: dirname(path), markdownIncludeRoot: ROOT });
function listMd(dir) {
  const d = join(ROOT, dir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".md")).sort()
    .map((f) => ({ slug: basename(f, ".md"), path: join(d, f) }));
}

const manifest = existsSync(join(ROOT, "alembic.json"))
  ? JSON.parse(read(join(ROOT, "alembic.json"))) : {};
const title = manifest.title || "Open educational resource";

const chapters = listMd("study-guide");
// Practice pages, plus pre-chapter worksheets (same slug → practice wins).
const practice = listMd("practice");
const taken = new Set(practice.map((p) => p.slug));
for (const w of listMd("materials/worksheets")) if (!taken.has(w.slug)) practice.push(w);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "practice"), { recursive: true });

let indexBody = `<h1>${esc(title)}</h1>\n`;
for (const ch of chapters) indexBody += render(ch.path) + "\n";
if (practice.length) {
  indexBody += "<hr>\n<h2>Practice</h2>\n<ul>\n";
  for (const p of practice)
    indexBody += `<li><a href="practice/${p.slug}.html">${esc(p.slug)}</a></li>\n`;
  indexBody += "</ul>";
}
writeFileSync(join(OUT, "index.html"), doc(title, indexBody));

for (const p of practice) {
  const body = `<p><a href="../index.html">← ${esc(title)}</a></p>\n` + render(p.path);
  writeFileSync(join(OUT, "practice", `${p.slug}.html`), doc(p.slug, body));
}

writeFileSync(join(OUT, ".nojekyll"), "");
console.log(`Built ${1 + practice.length} page(s) to _site/`);
