/**
 * Dual-extension `.md.html` artifacts: a rendered HTML document that also
 * embeds its editable Markdown source, extractable indefinitely.
 *
 * v0.1 implements this inside the renderer; it is a candidate for extraction
 * into a shared, published `orz-artifacts` package (see the orz-stack
 * consolidation plan, Phase B). The embedded format carries a version marker
 * so old files always remain extractable: files written before markers
 * existed are defined as "format 0".
 */

import { md } from "orz-markdown";
import { rendererVersion } from "./index";

export const MD_HTML_FORMAT_VERSION = 1;

const KATEX_CSS =
  "https://cdn.jsdelivr.net/npm/katex@0.16.35/dist/katex.min.css";

/** Escape a closing-script sequence so embedded source can't break out. */
export function escapeForScript(source: string): string {
  return source.replace(/<\/script>/gi, "<\\/script>");
}

export function unescapeFromScript(escaped: string): string {
  return escaped.replace(/<\\\/script>/gi, "</script>");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const BASE_CSS = `
:root { color-scheme: light dark; }
body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
pre { overflow-x: auto; padding: .75rem; background: rgba(127,127,127,.12); border-radius: .375rem; }
code { font-family: ui-monospace, monospace; }
table { border-collapse: collapse; } th, td { border: 1px solid rgba(127,127,127,.4); padding: .3rem .6rem; }
img { max-width: 100%; }
`.trim();

export interface BuildMdHtmlInput {
  title: string;
  /** orz-markdown source — becomes both the rendered body and the embedding. */
  markdown: string;
  /** Optional content hash to record for provenance (data attribute). */
  sourceHash?: string;
}

/** Build a self-contained `.md.html` document with embedded, extractable source. */
export function buildMdHtml(input: BuildMdHtmlInput): string {
  const body = md.render(input.markdown);
  const hashAttr = input.sourceHash
    ? ` data-orz-source-hash="${escapeHtml(input.sourceHash)}"`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<meta name="generator" content="Alembic (${escapeHtml(rendererVersion())})">
<link rel="stylesheet" href="${KATEX_CSS}">
<style>${BASE_CSS}</style>
</head>
<body>
<main class="orz-content">
${body}
</main>
<script type="text/markdown" id="md-source" data-orz-format="${MD_HTML_FORMAT_VERSION}"${hashAttr}>
${escapeForScript(input.markdown)}
</script>
</body>
</html>
`;
}

export interface ExtractedMdHtml {
  /** 0 means a legacy file with no format marker (still extractable). */
  formatVersion: number;
  markdown: string;
  sourceHash?: string;
}

/**
 * Extract the embedded Markdown source from a `.md.html` document. Returns
 * null if no embedded source is present. Tolerant of legacy (format 0) files
 * written without a version marker.
 */
export function extractMdHtml(html: string): ExtractedMdHtml | null {
  const match = html.match(
    /<script\s+([^>]*?type="text\/markdown"[^>]*?)>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  const attrs = match[1] ?? "";
  if (!/\bid="md-source"/.test(attrs)) return null;

  const formatVersion = Number(attrs.match(/data-orz-format="(\d+)"/)?.[1] ?? 0);
  const sourceHash = attrs.match(/data-orz-source-hash="([^"]*)"/)?.[1];
  // Strip the single leading/trailing newline introduced by the template.
  const raw = (match[2] ?? "").replace(/^\n/, "").replace(/\n$/, "");
  return {
    formatVersion,
    markdown: unescapeFromScript(raw),
    ...(sourceHash ? { sourceHash } : {}),
  };
}
