/**
 * `.slides.html` carriers: a lightweight, self-contained slide deck derived
 * from study-guide blocks. Each block becomes one slide. The rendered deck is a
 * scroll-snap stack of full-viewport sections, styled with the same
 * dark-elegant theme as the rest of Alembic, and it embeds its editable deck
 * source via the carriers codec so it round-trips losslessly.
 *
 * Like `mdhtml`, this lives in the renderer for v0.1 and is a candidate for the
 * shared `orz-artifacts` package later. Markdown rendering goes ONLY through
 * orz-markdown's `md`. Output is self-contained: inline CSS + JS, no CDN links.
 */

import { md } from "orz-markdown";
import { getKind } from "@alembic/carriers";
import { embedSource, extractSource, detectFormatVersion } from "@alembic/carriers";
import { escapeHtml } from "./document";
import { ORZ_DARK_ELEGANT_CSS } from "./theme-css";
import { rendererVersion } from "./index";

/** The format version this module writes for the "slides" kind. */
export const SLIDES_FORMAT_VERSION = getKind("slides")?.formatVersion ?? 1;

/**
 * Marker that begins every slide in an orz-slides deck. The marker IS the slide
 * separator — orz-slides splits the deck on `<!-- slide … -->` (there is no bare
 * `---`, and content before the first marker is read as deck preamble, not a
 * slide). The leading `## h2` after a marker becomes the slide's title band.
 */
const SLIDE_MARKER = "<!-- slide -->";

/** Matches a slide marker (`<!-- slide … -->`) alone on its line, after trim. */
const SLIDE_MARKER_RE = /^<!--\s*slide\b[^>]*-->$/;

/** Placeholder slide used when no usable blocks exist. */
const EMPTY_DECK_SLIDE = `${SLIDE_MARKER}\n## Untitled deck\n\nThis deck has no slides yet.`;

/** The leading `<!-- deck ... -->` config block (title/theme/ratio/footer). */
const DECK_BLOCK_RE = /^[ \t]*<!--\s*deck\b([\s\S]*?)-->/;

/**
 * Read the `theme:` value from a deck's leading `<!-- deck ... -->` config
 * block, if present. orz-slides rewrites this line back into the source every
 * time its own theme picker is used (self-reproducing — the picked theme is
 * never state that lives only in the DOM), so the deck source is the single
 * source of truth for "what theme did the educator last pick" — no separate
 * side-channel field needed to capture it.
 */
export function deckThemeFromSource(source: string): string | undefined {
  const block = source.match(DECK_BLOCK_RE);
  if (!block) return undefined;
  const line = block[1]!.match(/(^|\n)[ \t]*theme[ \t]*:[ \t]*([^\n]+)/);
  return line ? line[2]!.trim() : undefined;
}

/**
 * Force `theme` into a deck's leading `<!-- deck ... -->` config block —
 * replacing an existing `theme:` line or inserting one. Alembic wants ONE
 * course-wide slides theme (the manifest's `themes.slides` default,
 * `deckThemeFromSource`'s doc above), but orz-slides itself always prefers a
 * deck's OWN `theme:` line over any caller-supplied fallback — so a deck that
 * was last saved under an older theme keeps showing it forever, even after
 * the educator picks a new course-wide default elsewhere, unless something
 * rewrites it. Used to normalize a deck's source in memory right before
 * generating it for editing/viewing/publishing — never persisted back to the
 * chapter's own committed source, so re-picking a theme *in that deck*
 * (which does write back) still works exactly as before.
 */
export function withDeckTheme(source: string, theme: string): string {
  const block = source.match(DECK_BLOCK_RE);
  if (!block) {
    return `<!-- deck\ntheme: ${theme}\n-->\n\n${source}`;
  }
  const inner = block[1]!;
  const hasThemeLine = /(^|\n)[ \t]*theme[ \t]*:[ \t]*[^\n]+/.test(inner);
  const nextInner = hasThemeLine
    ? inner.replace(/(^|\n)([ \t]*theme[ \t]*:[ \t]*)[^\n]+/, `$1$2${theme}`)
    : `${inner}\ntheme: ${theme}\n`;
  return `<!-- deck${nextInner}-->` + source.slice(block[0].length);
}

export interface SlideBlock {
  title: string;
  body: string;
}

/**
 * Derive an orz-slides deck source from study-guide blocks: each block → one
 * slide, `<!-- slide -->` marker + `## {title}` heading (the heading becomes the
 * slide's title band) + body. Blocks whose title AND body are both empty (after
 * trimming) are skipped. If no usable blocks remain, returns a single
 * placeholder slide so the deck is never empty.
 */
export function slidesSourceFromBlocks(blocks: Array<SlideBlock>): string {
  const slides: string[] = [];
  for (const block of blocks) {
    const title = (block.title ?? "").trim();
    const body = (block.body ?? "").trim();
    if (title === "" && body === "") continue;
    const heading = title ? `## ${title}` : "";
    slides.push([SLIDE_MARKER, heading, body].filter(Boolean).join("\n\n"));
  }
  if (slides.length === 0) return EMPTY_DECK_SLIDE;
  return slides.join("\n\n");
}

/**
 * Split a deck source into per-slide markdown chunks. A slide boundary is a
 * `<!-- slide … -->` marker alone on its line (the orz-slides grammar); a bare
 * `---` line is still honored for legacy decks. The marker line itself is
 * dropped from the chunk. Content before the first marker is its own leading
 * chunk. Leading/trailing blank lines are trimmed per chunk.
 */
export function splitSlides(source: string): string[] {
  // Drop the leading `<!-- deck … -->` config block first: it is deck metadata
  // (title/theme/ratio), not a slide. Left in, it lands in the pre-first-marker
  // chunk and renders as a blank phantom first slide for an orz-slides–authored
  // deck (which always opens with this block). orz-slides itself consumes it.
  const lines = source.replace(DECK_BLOCK_RE, "").split(/\r?\n/);
  const chunks: string[][] = [[]];
  for (const line of lines) {
    const t = line.trim();
    if (SLIDE_MARKER_RE.test(t)) {
      chunks.push([]); // marker starts a new slide; the marker line is dropped
    } else if (t === "---") {
      chunks.push([]);
    } else {
      chunks[chunks.length - 1]!.push(line);
    }
  }
  return chunks
    .map((chunkLines) => chunkLines.join("\n").replace(/^\s*\n/, "").replace(/\n\s*$/, "").trim())
    .filter((chunk) => chunk !== ""); // drop the empty pre-first-marker lead chunk
}

/** Deck-specific CSS layered on top of the shared dark-elegant theme. */
const DECK_CSS = `
/* --- slide deck shell --- */
html, body { height: 100%; }
body { padding: 0; overflow: hidden; }
.deck {
  height: 100vh;
  overflow-y: scroll;
  /* proximity (not mandatory): a slide taller than the viewport — e.g. a
     step/reveal slide whose items this non-reveal fallback shows all at once —
     must NOT capture the snap and trap navigation. Keyboard nav below is the
     authoritative control; snapping only tidies resting position. */
  scroll-snap-type: y proximity;
  scroll-behavior: smooth;
}
.deck::-webkit-scrollbar { width: 0; height: 0; }
.slide {
  min-height: 100vh;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  /* flex-start so a slide taller than the viewport starts at the top and scrolls
     down naturally (center would clip its head off-screen with no way to reach it). */
  justify-content: flex-start;
  align-items: center;
  padding: clamp(1.5rem, 6vh, 5rem) clamp(1rem, 6vw, 4rem);
  box-sizing: border-box;
}
/* Vertically center content that fits, without clipping content that doesn't. */
.slide .markdown-body { margin-block: auto; }
.slide .markdown-body {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
  width: 100%;
  max-width: var(--markdown-body-max-width);
}
.deck-counter {
  position: fixed;
  bottom: 1rem;
  right: 1.25rem;
  z-index: 10;
  font-family: 'JetBrains Mono', monospace;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  background: rgba(13, 15, 24, 0.7);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.25em 0.85em;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  pointer-events: none;
}
`;

/** Inline navigation script. Browser-only — guards for document/window. */
const DECK_NAV_JS = `
(function () {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  var deck = document.querySelector(".deck");
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  var counter = document.querySelector(".deck-counter");
  if (!deck || slides.length === 0) return;

  // Explicit current index is the SOURCE OF TRUTH for keyboard nav. Deriving it
  // from scrollTop (the old behavior) let mandatory snap re-capture an oversized
  // slide mid-animation, cancelling the move and trapping the deck — a key press
  // must always advance regardless of scroll resting position.
  var idx = 0;
  var programmatic = false;
  var settle;
  function clamp(i) { return Math.max(0, Math.min(slides.length - 1, i)); }
  function fromScroll() {
    var mid = deck.scrollTop + deck.clientHeight / 2;
    var n = 0;
    for (var i = 0; i < slides.length; i++) { if (slides[i].offsetTop <= mid) n = i; }
    return n;
  }
  function updateCounter() {
    if (counter) counter.textContent = (idx + 1) + " / " + slides.length;
  }
  function go(i) {
    idx = clamp(i);
    programmatic = true;               // ignore the scroll events this triggers
    slides[idx].scrollIntoView({ behavior: "smooth", block: "start" });
    updateCounter();
    clearTimeout(settle);
    settle = setTimeout(function () { programmatic = false; }, 700);
  }

  document.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Spacebar") {
      e.preventDefault();
      go(idx + 1);
    } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") {
      e.preventDefault();
      go(idx - 1);
    }
  });
  // A manual scroll (not one of our own) re-syncs the index so the next key press
  // continues from where the reader actually is.
  deck.addEventListener("scroll", function () {
    if (programmatic) return;
    idx = fromScroll();
    updateCounter();
  }, { passive: true });
  updateCounter();
})();
`;

export interface BuildSlidesInput {
  title: string;
  /** The deck source (slides separated by `---`). */
  source: string;
}

/**
 * Build a self-contained `.slides.html` carrier. Each slide chunk is rendered
 * with `md.render` into a `<section class="slide">`, wrapped in a full themed
 * HTML document (dark-elegant theme + deck CSS + nav JS), then the deck
 * `source` is embedded via the carriers codec (kind "slides").
 */
export function buildSlidesHtml(input: BuildSlidesInput): string {
  const chunks = splitSlides(input.source);
  const sections = chunks
    .map(
      (chunk) =>
        `<section class="slide"><div class="markdown-body">\n${md.render(chunk)}\n</div></section>`,
    )
    .join("\n");

  const rendered = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<meta name="generator" content="Alembic (${escapeHtml(rendererVersion())})">
<style>
${ORZ_DARK_ELEGANT_CSS}
${DECK_CSS}
</style>
</head>
<body>
<div class="deck">
${sections}
</div>
<div class="deck-counter" aria-hidden="true"></div>
<script>
${DECK_NAV_JS}
</script>
</body>
</html>
`;

  return embedSource({
    kind: "slides",
    format: SLIDES_FORMAT_VERSION,
    payload: "html",
    rendered,
    source: input.source,
  });
}

export interface ExtractedSlides {
  source: string;
  formatVersion: number;
}

/**
 * Extract the embedded deck source from a `.slides.html` carrier. Returns null
 * if the file has no carrier source island.
 */
export function extractSlides(file: string): ExtractedSlides | null {
  try {
    const result = extractSource(file);
    return {
      source: result.source,
      formatVersion: detectFormatVersion(file) ?? SLIDES_FORMAT_VERSION,
    };
  } catch {
    return null;
  }
}
