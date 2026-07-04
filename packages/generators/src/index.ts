/**
 * Worker-tier generation of the orz-family self-contained files. Alembic does
 * NOT build its own `.md.html` / `.slides.html` / `.paged.html`: it calls the
 * upstream generators (orz-mdhtml / orz-slides / orz-paged), so every file it
 * produces carries the upstream in-file editor + the `orz-host-save` protocol.
 *
 * These generators are **Node-only** — they read their package assets from
 * disk at runtime (via `import.meta.url`). That is fine here: this package runs
 * in the **worker tier**, never in a Vercel serverless function (whose file
 * tracing wouldn't ship those assets). The web app reaches this through the
 * worker's HTTP endpoint, never by importing it directly.
 *
 * Output is fully **inline** (self-contained, ~0.8–1.5 MB) — the right shape
 * for a downloadable file that stays editable offline forever. A leaner CDN
 * mode for repo-committed study guides (Roadmap E3) is a future upstream option.
 */

import { buildMdHtml } from "orz-mdhtml";
import { buildSlidesHtml } from "orz-slides";
import { buildPagedHtml } from "orz-paged";

/** The self-contained document kinds Alembic generates. */
export type SelfContainedKind = "md" | "slides" | "paged";

export interface GenerateInput {
  kind: SelfContainedKind;
  /** orz-markdown source (with the format's layout syntax where relevant). */
  markdown: string;
  /** Document `<title>` (default: the tool's own, "Untitled"). */
  title?: string;
  /**
   * orz theme id, passed straight to the tool (unknown ids fall back to the
   * tool's own default). Theme ids differ per tool, so the caller — which owns
   * any `RenderTheme`-style abstraction — resolves the id; this package stays
   * theme-agnostic.
   */
  theme?: string;
}

/**
 * Generate a self-contained orz file. Synchronous (the upstream builders are),
 * but exposed as async so the worker transport and any future CDN/remote mode
 * can swap in without changing callers.
 */
export async function generateSelfContained(input: GenerateInput): Promise<string> {
  const opts = { markdown: input.markdown, title: input.title, theme: input.theme };
  switch (input.kind) {
    case "md":
      return buildMdHtml(opts);
    case "slides":
      return buildSlidesHtml(opts);
    case "paged":
      return buildPagedHtml(opts);
    default: {
      // Exhaustive: a new kind must be handled here explicitly.
      const never: never = input.kind;
      throw new Error(`generateSelfContained: unknown kind ${String(never)}`);
    }
  }
}

/** The file extension each kind writes (for download names / repo paths). */
export const KIND_EXTENSION: Record<SelfContainedKind, string> = {
  md: ".md.html",
  slides: ".slides.html",
  paged: ".paged.html",
};
