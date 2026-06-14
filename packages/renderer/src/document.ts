/**
 * Shared themed HTML document. All rendered output — in-app preview, the
 * worksheet viewer, the published site, and `.md.html` exports — uses this so
 * they look identical: orz-markdown's dark-elegant theme, applied to content
 * wrapped in `.markdown-body` (the class the theme targets).
 */

import { md } from "orz-markdown";
import { rendererVersion } from "./index";
import { ORZ_DARK_ELEGANT_CSS } from "./theme-css";

const KATEX_CSS =
  "https://cdn.jsdelivr.net/npm/katex@0.16.35/dist/katex.min.css";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ThemedDocOptions {
  title: string;
  /** HTML placed inside the themed `.markdown-body` container. */
  bodyHtml: string;
  /** Raw HTML appended after the content (e.g. an embedded-source script). */
  trailingHtml?: string;
}

/** Wrap rendered HTML in a self-contained, dark-elegant themed document. */
export function themedDocument(opts: ThemedDocOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<meta name="generator" content="Alembic (${escapeHtml(rendererVersion())})">
<link rel="stylesheet" href="${KATEX_CSS}">
<style>
${ORZ_DARK_ELEGANT_CSS}
</style>
</head>
<body>
<div class="markdown-body">
${opts.bodyHtml}
</div>${opts.trailingHtml ? `\n${opts.trailingHtml}` : ""}
</body>
</html>
`;
}

/** Render orz-markdown source to a full themed document (preview / viewer). */
export function renderDocument(title: string, markdown: string): string {
  return themedDocument({ title, bodyHtml: md.render(markdown) });
}
