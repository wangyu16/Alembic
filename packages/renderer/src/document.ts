/**
 * Shared themed HTML document. All rendered output — in-app preview, the
 * worksheet viewer, the published site, and `.md.html` exports — uses this so
 * they look identical. The theme is selectable: orz-markdown's `dark-elegant-1`
 * (default) or `light-academic-1` when the educator picks the light theme. Content
 * is wrapped in `.markdown-body` (the class the themes target).
 */

import { md } from "orz-markdown";
import { getBrowserRuntimeScript } from "orz-markdown/runtime";
import { rendererVersion } from "./index";
import { themeCss, type RenderTheme } from "./theme-css";

/**
 * orz-markdown's browser runtime — the SAME layer `.md.html` inlines. Once
 * loaded it powers **copy-as-Markdown** (select rendered content, Cmd/Ctrl-C →
 * Markdown source, via a DOM→Markdown walker over `.markdown-body`, reading
 * preserved `data-md` attributes) plus QR/tab enhancements. Computed once.
 */
const RUNTIME_SCRIPT = `<script>${getBrowserRuntimeScript()}</script>`;

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
  /** Raw HTML injected into <head> (e.g. a JSON-LD LearningResource script). */
  headHtml?: string;
  /** Rendered theme — dark-elegant (default) or light-academic. */
  theme?: RenderTheme;
}

/** Wrap rendered HTML in a self-contained themed document (dark-elegant by default). */
export function themedDocument(opts: ThemedDocOptions): string {
  const theme: RenderTheme = opts.theme ?? "dark";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${theme}">
<title>${escapeHtml(opts.title)}</title>
<meta name="generator" content="Alembic (${escapeHtml(rendererVersion())})">
<link rel="stylesheet" href="${KATEX_CSS}">
<style>
${themeCss(theme)}
</style>${opts.headHtml ? `\n${opts.headHtml}` : ""}
</head>
<body>
<div class="markdown-body">
${opts.bodyHtml}
</div>${opts.trailingHtml ? `\n${opts.trailingHtml}` : ""}
${RUNTIME_SCRIPT}
</body>
</html>
`;
}

/**
 * Render orz-markdown source to a full themed document (preview / viewer).
 * `heading`, when given, becomes the page h1 above the content — mirroring the
 * published chapter page, where the chapter title is the h1 (not in the
 * markdown, since blocks are h2).
 */
export function renderDocument(
  title: string,
  markdown: string,
  theme: RenderTheme = "dark",
  heading?: string,
): string {
  const h1 = heading ? `<h1>${escapeHtml(heading)}</h1>\n` : "";
  return themedDocument({ title, bodyHtml: h1 + md.render(markdown), theme });
}
