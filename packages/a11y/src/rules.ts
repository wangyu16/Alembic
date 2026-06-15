// Accessibility rule scanners.
//
// Each scanner reads a string of already-rendered HTML and produces zero or
// more findings. All findings carry educator-facing language — no HTML/Git
// jargon. The scanners use targeted regexes (NOT a markdown or HTML parser).

import { getAttr, visibleText } from "./html";

export type A11ySeverity = "error" | "warning";

export type A11yRule =
  | "img-alt"
  | "heading-order"
  | "empty-heading"
  | "link-text"
  | "table-header";

export interface A11yFinding {
  rule: A11yRule;
  severity: A11ySeverity;
  message: string;
  context: string;
}

/** Non-descriptive link phrases (compared case-insensitively, trimmed). */
const VAGUE_LINK_PHRASES = new Set([
  "click here",
  "here",
  "read more",
  "more",
  "link",
  "this",
  "this link",
]);

/** True if link text is just a bare URL the educator pasted in. */
function isBareUrl(text: string): boolean {
  return /^(https?:\/\/|www\.)\S*$/i.test(text);
}

/**
 * img-alt — images must describe themselves for screen-reader users.
 *  - no alt attribute at all                -> error
 *  - alt empty AND explicitly decorative    -> skip (intentional)
 *  - alt empty with nothing else            -> warning (confirm decorative)
 *  - alt is only whitespace                 -> error (looks like a mistake)
 */
export function checkImages(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const imgTag = /<img\b[^>]*>/gi;
  for (const match of html.matchAll(imgTag)) {
    const tag = match[0];
    const src = getAttr(tag, "src") ?? "";
    // A filename is friendlier than a full path for locating the image.
    const fileName = src.split(/[\\/]/).pop() ?? src;
    const context = fileName;

    const alt = getAttr(tag, "alt");
    if (alt === undefined) {
      findings.push({
        rule: "img-alt",
        severity: "error",
        message:
          "This image has no description for screen-reader users. Add a short description of what it shows, or mark it as decorative if it carries no meaning.",
        context,
      });
      continue;
    }

    const role = (getAttr(tag, "role") ?? "").trim().toLowerCase();
    const ariaHidden = (getAttr(tag, "aria-hidden") ?? "").trim().toLowerCase();
    const markedDecorative = role === "presentation" || ariaHidden === "true";

    if (alt.trim() === "") {
      if (markedDecorative) {
        // Explicitly decorative + empty description: intentional, skip.
        continue;
      }
      if (alt === "") {
        findings.push({
          rule: "img-alt",
          severity: "warning",
          message:
            "This image looks decorative because it has an empty description. Confirm it carries no meaning for readers; if it does, add a description.",
          context,
        });
      } else {
        // Whitespace-only alt is almost always an accident.
        findings.push({
          rule: "img-alt",
          severity: "error",
          message:
            "This image has only blank space where its description should be. Add a short description of what it shows.",
          context,
        });
      }
    }
    // A real, non-empty alt is good — no finding.
  }
  return findings;
}

/** A heading found in the document, with its level and visible text. */
export interface HeadingHit {
  level: number;
  text: string;
}

/** Pull every heading (h1–h6) out of a fragment, in document order. */
export function extractHeadings(html: string): HeadingHit[] {
  const heading = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const hits: HeadingHit[] = [];
  for (const match of html.matchAll(heading)) {
    const level = Number(match[1]);
    const text = visibleText(match[2] ?? "");
    hits.push({ level, text });
  }
  return hits;
}

/**
 * empty-heading — a heading with no visible text gives readers a useless
 * landmark. Error severity.
 */
export function checkEmptyHeadings(headings: HeadingHit[]): A11yFinding[] {
  const findings: A11yFinding[] = [];
  for (const h of headings) {
    if (h.text === "") {
      findings.push({
        rule: "empty-heading",
        severity: "error",
        message:
          "This section heading is empty. Add a few words so readers know what the section is about.",
        context: `(empty h${h.level})`,
      });
    }
  }
  return findings;
}

/**
 * heading-order — section headings should step down one level at a time so
 * the outline is easy to follow. We flag a SKIP going deeper (e.g. a level-2
 * heading followed directly by a level-4 one). Warning severity.
 *
 * Empty headings are skipped here (they're reported by checkEmptyHeadings) so
 * we don't double-flag, but they still count toward the level sequence.
 *
 * Starting at h2 is normal in Alembic (the page H1 is the site shell's chapter
 * title), so we never flag "starts too deep" — only true skips between
 * consecutive headings.
 */
export function checkHeadingOrder(headings: HeadingHit[]): A11yFinding[] {
  const findings: A11yFinding[] = [];
  let previousLevel: number | null = null;
  for (const h of headings) {
    if (previousLevel !== null && h.level > previousLevel + 1) {
      const label = h.text === "" ? `(empty h${h.level})` : h.text;
      findings.push({
        rule: "heading-order",
        severity: "warning",
        message:
          "This heading jumps down more than one level, which can confuse readers navigating by headings. Use the next level down instead of skipping.",
        context: label,
      });
    }
    previousLevel = h.level;
  }
  return findings;
}

/**
 * link-text — links should describe where they go. Flags vague phrases and
 * bare pasted URLs. Warning severity.
 */
export function checkLinks(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const anchor = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchor)) {
    const text = visibleText(match[1] ?? "");
    if (text === "") continue; // Empty links are a separate concern; skip here.
    const normalized = text.toLowerCase();
    const vague = VAGUE_LINK_PHRASES.has(normalized);
    const bare = isBareUrl(text);
    if (vague || bare) {
      findings.push({
        rule: "link-text",
        severity: "warning",
        message: bare
          ? 'This link shows a web address instead of a description. Use words that say where it goes (for example, "the periodic table reference").'
          : 'This link text does not say where it goes. Replace vague wording like "click here" with a description of the destination.',
        context: text,
      });
    }
  }
  return findings;
}

/**
 * table-header — a data table needs header cells so screen-reader users can
 * make sense of each value. Flags a table that has data cells but no header
 * cells anywhere. Warning severity.
 */
export function checkTables(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  for (const match of html.matchAll(table)) {
    const body = match[1] ?? "";
    const hasData = /<td\b[^>]*>/i.test(body);
    const hasHeader = /<th\b[^>]*>/i.test(body);
    if (hasData && !hasHeader) {
      // Use the table's caption as context if there is one.
      const caption = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(body);
      const context = caption ? visibleText(caption[1] ?? "") : "";
      findings.push({
        rule: "table-header",
        severity: "warning",
        message:
          "This table has no header row, so screen-reader users can't tell what each column or row means. Mark the first row or column as headers.",
        context,
      });
    }
  }
  return findings;
}
