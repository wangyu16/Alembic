/**
 * Dual-extension `.md.html` artifacts: a rendered HTML document (dark-elegant
 * theme) that also embeds its editable Markdown source, extractable
 * indefinitely.
 *
 * As of M13 the embedding/extraction is delegated to the shared `@alembic/carriers`
 * codec (the `orz-carrier` HTML island, kind "md"). Files written before this
 * migration used an in-document `<script id="md-source">` island ("legacy
 * format 0" / format 1 with `data-orz-format`); `extractMdHtml` still reads
 * those via the regex fallback below, so old files always remain extractable.
 */

import { md } from "orz-markdown";
import {
  embedSource,
  extractSource,
  detectFormatVersion,
  getKind,
} from "@alembic/carriers";
import { themedDocument } from "./document";

export const MD_HTML_FORMAT_VERSION = 1;

/** Escape a closing-script sequence so embedded source can't break out.
 * Retained for the LEGACY (`id="md-source"`) extraction path only. */
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
  /**
   * Optional content hash. Kept for call-site compatibility but no longer
   * stamped into the file — provenance is logged via research-events elsewhere.
   * Currently unused.
   */
  sourceHash?: string;
}

/** Build a self-contained `.md.html` carrier with embedded, extractable source. */
export function buildMdHtml(input: BuildMdHtmlInput): string {
  const rendered = themedDocument({
    title: input.title,
    bodyHtml: md.render(input.markdown),
  });
  return embedSource({
    kind: "md",
    format: getKind("md")?.formatVersion ?? MD_HTML_FORMAT_VERSION,
    payload: "html",
    rendered,
    source: input.markdown,
  });
}

export interface ExtractedMdHtml {
  /** 0 means a legacy file with no format marker (still extractable). */
  formatVersion: number;
  markdown: string;
  /** Only present on legacy files that recorded one; undefined for new files. */
  sourceHash?: string;
}

/**
 * Extract the embedded Markdown source from a `.md.html` document.
 *
 * Tries the carriers `orz-carrier` island first (new files). If none is found,
 * falls back to the legacy `<script id="md-source">` island (format 0, or the
 * `data-orz-format` value if present). Returns null when neither is present.
 */
export function extractMdHtml(html: string): ExtractedMdHtml | null {
  // Legacy first: the old <script id="md-source"> island also carries the
  // provenance source-hash, which the shared carriers codec doesn't model. The
  // `md-source` id can't match a new `orz-carrier` file, so new files fall
  // through to the codec below.
  const match = html.match(
    /<script\s+([^>]*?type="text\/markdown"[^>]*?)>([\s\S]*?)<\/script>/i,
  );
  if (match && /\bid="md-source"/.test(match[1] ?? "")) {
    const attrs = match[1] ?? "";
    const formatVersion = Number(attrs.match(/data-orz-format="(\d+)"/)?.[1] ?? 0);
    const sourceHash = attrs.match(/data-orz-source-hash="([^"]*)"/)?.[1];
    // Strip the single leading/trailing newline introduced by the old template.
    const raw = (match[2] ?? "").replace(/^\n/, "").replace(/\n$/, "");
    return {
      formatVersion,
      markdown: unescapeFromScript(raw),
      ...(sourceHash ? { sourceHash } : {}),
    };
  }

  // New codec: the shared carrier island.
  try {
    const result = extractSource(html);
    return {
      formatVersion: detectFormatVersion(html) ?? MD_HTML_FORMAT_VERSION,
      markdown: result.source,
    };
  } catch {
    return null;
  }
}
