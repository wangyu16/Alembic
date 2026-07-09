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
  const lines = source.split(/\r?\n/);
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
  scroll-snap-type: y mandatory;
  scroll-behavior: smooth;
}
.deck::-webkit-scrollbar { width: 0; height: 0; }
.slide {
  min-height: 100vh;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: clamp(1.5rem, 6vh, 5rem) clamp(1rem, 6vw, 4rem);
  box-sizing: border-box;
}
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

  function current() {
    var mid = deck.scrollTop + deck.clientHeight / 2;
    var idx = 0;
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].offsetTop <= mid) idx = i;
    }
    return idx;
  }
  function go(i) {
    var clamped = Math.max(0, Math.min(slides.length - 1, i));
    slides[clamped].scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function updateCounter() {
    if (counter) counter.textContent = (current() + 1) + " / " + slides.length;
  }

  document.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Spacebar") {
      e.preventDefault();
      go(current() + 1);
    } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") {
      e.preventDefault();
      go(current() - 1);
    }
  });
  deck.addEventListener("scroll", updateCounter, { passive: true });
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
