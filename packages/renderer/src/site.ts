/**
 * Static-site builder: renders a package's public content into a small set of
 * HTML files for GitHub Pages, using the shared dark-elegant themed document.
 * v0.1 builds in-process (orz-markdown is fast, the content is small); the
 * output is a flat file list the caller pushes to the Pages branch. The
 * renderer version is stamped into build metadata.
 */

import { md } from "orz-markdown";
import { rendererVersion } from "./index";
import { escapeHtml, themedDocument } from "./document";
import type { RenderTheme } from "./theme-css";

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
  /** Render theme — matches the educator's editor selection (default dark). */
  theme?: RenderTheme;
}

export interface SiteFile {
  path: string;
  content: string;
}

/** Build the static site file set for a package's public content. */
export function buildSite(input: SiteInput): SiteFile[] {
  const files: SiteFile[] = [];

  const worksheetNav = input.worksheets.length
    ? `<hr>\n<h2>Worksheets</h2>\n<ul>\n${input.worksheets
        .map((w) => `<li><a href="worksheets/${w.slug}.html">${escapeHtml(w.title)}</a></li>`)
        .join("\n")}\n</ul>`
    : "";

  const indexBody = `<h1>${escapeHtml(input.title)}</h1>\n${md.render(
    input.studyGuideMarkdown,
  )}${worksheetNav ? `\n${worksheetNav}` : ""}`;
  files.push({
    path: "index.html",
    content: themedDocument({ title: input.title, bodyHtml: indexBody, theme: input.theme }),
  });

  for (const w of input.worksheets) {
    const body = `<p><a href="../index.html">← ${escapeHtml(input.title)}</a></p>\n<h1>${escapeHtml(
      w.title,
    )}</h1>\n${md.render(w.markdown)}`;
    files.push({
      path: `worksheets/${w.slug}.html`,
      content: themedDocument({ title: w.title, bodyHtml: body, theme: input.theme }),
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
