import "server-only";
import { auditFragments, type A11yReport } from "@alembic/a11y";
import { renderMarkdown } from "@alembic/renderer";
import type { StudyGuideDoc } from "@alembic/package-ops";

/**
 * Accessibility for the study guide (M14).
 *
 * The audit runs over *rendered HTML* (orz-markdown via @alembic/renderer) so
 * we never add a second markdown parser. Each block becomes a labeled fragment
 * so findings carry a human location ("In 'Equilibrium': …").
 *
 * Separately, `listFixables` does a NARROW regex scan of the markdown source
 * (image and link syntax only — not a markdown parser) to recover the exact
 * source target an AI fix must rewrite (image URL, link URL + current text).
 */

export type { A11yReport };

const blockLabel = (title: string) => title.trim() || "Untitled section";

/** Audit one chapter's study-guide document. */
export function auditDoc(doc: StudyGuideDoc): A11yReport {
  const fragments = doc.blocks.map((b) => ({
    label: blockLabel(b.title),
    html: renderMarkdown(b.body),
  }));
  if (doc.preamble.trim()) {
    fragments.unshift({ label: "Introduction", html: renderMarkdown(doc.preamble) });
  }
  return auditFragments(fragments);
}

export type FixableRule = "img-alt" | "link-text";

export interface Fixable {
  /** Stable-ish id for React keys: block index + rule + occurrence. */
  id: string;
  rule: FixableRule;
  blockTitle: string;
  /** The image/link URL to locate in the source. */
  url: string;
  /** Current link text (empty for images). Used to locate links + as the thing replaced. */
  oldText: string;
  /** A short surrounding snippet to give the AI (and the educator) context. */
  context: string;
}

// Non-descriptive link phrases (mirrors @alembic/a11y's link-text rule).
const WEAK_LINK_TEXT = new Set([
  "click here",
  "here",
  "read more",
  "more",
  "link",
  "this",
  "this link",
]);

function isWeakLinkText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (WEAK_LINK_TEXT.has(t)) return true;
  return /^(https?:\/\/|www\.)/i.test(t);
}

function snippet(source: string, index: number, len: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(source.length, index + len + 40);
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

// Image: ![alt](url ...). Capture alt (1) and url (2).
const IMG_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
// Link: [text](url ...) NOT preceded by '!'. Capture text (1) and url (2).
const LINK_RE = /(^|[^!])\[([^\]]+)\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;

/**
 * Find AI-remediable accessibility issues in the saved markdown of each block,
 * with the exact source target needed to apply a fix later.
 */
export function listFixables(
  blocks: Array<{ title: string; body: string }>,
): Fixable[] {
  const out: Fixable[] = [];
  blocks.forEach((block, bi) => {
    const body = block.body;
    let occ = 0;

    IMG_RE.lastIndex = 0;
    for (let m = IMG_RE.exec(body); m; m = IMG_RE.exec(body)) {
      const alt = m[1] ?? "";
      const url = m[2] ?? "";
      if (alt.trim() === "" && url) {
        out.push({
          id: `${bi}:img:${occ++}`,
          rule: "img-alt",
          blockTitle: blockLabel(block.title),
          url,
          oldText: "",
          context: snippet(body, m.index, m[0].length),
        });
      }
    }

    LINK_RE.lastIndex = 0;
    for (let m = LINK_RE.exec(body); m; m = LINK_RE.exec(body)) {
      const text = m[2] ?? "";
      const url = m[3] ?? "";
      if (url && isWeakLinkText(text)) {
        out.push({
          id: `${bi}:link:${occ++}`,
          rule: "link-text",
          blockTitle: blockLabel(block.title),
          url,
          oldText: text,
          context: snippet(body, m.index, m[0].length),
        });
      }
    }
  });
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Apply an accepted a11y fix to a block body: set an image's alt text, or
 * replace a link's text — located by URL (and current text for links). Returns
 * the new body, or null if the target could no longer be found (e.g. the
 * educator already edited it). Only the first match is changed.
 */
export function applyA11yFix(
  body: string,
  fix: { rule: FixableRule; url: string; oldText: string; suggestion: string },
): string | null {
  if (fix.rule === "img-alt") {
    // ![<any alt>](<url>  →  ![suggestion](<url>
    const re = new RegExp(`(!\\[)[^\\]]*(\\]\\(\\s*<?${escapeRe(fix.url)})`);
    if (!re.test(body)) return null;
    return body.replace(re, `$1${fix.suggestion}$2`);
  }
  // link-text: [oldText](url) → [suggestion](url)
  const re = new RegExp(
    `(\\[)${escapeRe(fix.oldText)}(\\]\\(\\s*<?${escapeRe(fix.url)})`,
  );
  if (!re.test(body)) return null;
  return body.replace(re, `$1${fix.suggestion}$2`);
}
