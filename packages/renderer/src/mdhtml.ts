/**
 * Dual-extension `.md.html` artifacts: a rendered HTML document (dark-elegant
 * theme) that also embeds its editable Markdown source, extractable
 * indefinitely.
 *
 * v0.1 implements this inside the renderer; it is a candidate for extraction
 * into a shared, published `orz-artifacts` package (see the orz-stack
 * consolidation plan, Phase B). The embedded format carries a version marker
 * so old files always remain extractable: files written before markers
 * existed are defined as "format 0".
 */

import { md } from "orz-markdown";
import { themedDocument } from "./document";

export const MD_HTML_FORMAT_VERSION = 1;

/** Escape a closing-script sequence so embedded source can't break out. */
export function escapeForScript(source: string): string {
  return source.replace(/<\/script>/gi, "<\\/script>");
}

export function unescapeFromScript(escaped: string): string {
  return escaped.replace(/<\\\/script>/gi, "</script>");
}

export interface BuildMdHtmlInput {
  title: string;
  /** orz-markdown source — becomes both the rendered body and the embedding. */
  markdown: string;
  /** Optional content hash to record for provenance (data attribute). */
  sourceHash?: string;
}

/** Build a self-contained `.md.html` document with embedded, extractable source. */
export function buildMdHtml(input: BuildMdHtmlInput): string {
  const hashAttr = input.sourceHash
    ? ` data-orz-source-hash="${input.sourceHash.replace(/"/g, "&quot;")}"`
    : "";
  const trailing = `<script type="text/markdown" id="md-source" data-orz-format="${MD_HTML_FORMAT_VERSION}"${hashAttr}>
${escapeForScript(input.markdown)}
</script>`;
  return themedDocument({
    title: input.title,
    bodyHtml: md.render(input.markdown),
    trailingHtml: trailing,
  });
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
