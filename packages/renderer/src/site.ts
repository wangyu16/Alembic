/**
 * Static-site builder: renders a package's public content into a small set of
 * HTML files for GitHub Pages. v0.1 builds in-process (orz-markdown is fast,
 * the content is small); the output is a flat file list the caller pushes to
 * the Pages branch. The renderer version is stamped into build metadata.
 */

import { md } from "orz-markdown";
import { rendererVersion } from "./index";

const KATEX_CSS =
  "https://cdn.jsdelivr.net/npm/katex@0.16.35/dist/katex.min.css";

const SITE_CSS = `
:root { color-scheme: light dark; }
body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 46rem; margin: 0 auto; padding: 2rem 1rem; }
nav { margin-bottom: 1.5rem; font-size: .9rem; }
a { color: #1d4ed8; } @media (prefers-color-scheme: dark) { a { color: #93c5fd; } }
pre { overflow-x: auto; padding: .75rem; background: rgba(127,127,127,.12); border-radius: .375rem; }
code { font-family: ui-monospace, monospace; }
table { border-collapse: collapse; } th, td { border: 1px solid rgba(127,127,127,.4); padding: .3rem .6rem; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid rgba(127,127,127,.3); margin: 2rem 0; }
`.trim();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, bodyHtml: string, nav?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="generator" content="Alembic (${escapeHtml(rendererVersion())})">
<link rel="stylesheet" href="${KATEX_CSS}">
<style>${SITE_CSS}</style>
</head>
<body>
${nav ? `<nav>${nav}</nav>\n` : ""}${bodyHtml}
</body>
</html>
`;
}

export interface SiteWorksheet {
  title: string;
  /** URL-safe slug; becomes worksheets/<slug>.html. */
  slug: string;
  markdown: string;
}

export interface SiteInput {
  title: string;
  studyGuideMarkdown: string;
  worksheets: SiteWorksheet[];
  /** ISO timestamp, passed in for deterministic builds. */
  builtAt: string;
}

export interface SiteFile {
  path: string;
  content: string;
}

/** Build the static site file set for a package's public content. */
export function buildSite(input: SiteInput): SiteFile[] {
  const files: SiteFile[] = [];

  const worksheetNav = input.worksheets.length
    ? `<h2>Worksheets</h2>\n<ul>\n${input.worksheets
        .map((w) => `<li><a href="worksheets/${w.slug}.html">${escapeHtml(w.title)}</a></li>`)
        .join("\n")}\n</ul>`
    : "";

  const indexBody = `<h1>${escapeHtml(input.title)}</h1>\n${md.render(
    input.studyGuideMarkdown,
  )}${worksheetNav ? `\n<hr>\n${worksheetNav}` : ""}`;
  files.push({ path: "index.html", content: page(input.title, indexBody) });

  for (const w of input.worksheets) {
    const body = `<h1>${escapeHtml(w.title)}</h1>\n${md.render(w.markdown)}`;
    files.push({
      path: `worksheets/${w.slug}.html`,
      content: page(w.title, body, `<a href="../index.html">← ${escapeHtml(input.title)}</a>`),
    });
  }

  files.push({
    path: "build-info.json",
    content:
      JSON.stringify(
        { generator: "Alembic", renderer: rendererVersion(), builtAt: input.builtAt },
        null,
        2,
      ) + "\n",
  });
  // Tell GitHub Pages to serve files as-is (no Jekyll processing).
  files.push({ path: ".nojekyll", content: "" });

  return files;
}
