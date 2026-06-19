/**
 * Multi-chapter static-site builder: renders a course (one or more chapters
 * plus optional worksheets) into an HTML file set for GitHub Pages, using the
 * shared dark-elegant themed document.
 *
 * Layout:
 *   index.html              — course title + chapter TOC (multi) or the single
 *                             chapter inline (single) + optional worksheet nav
 *   chapters/<slug>.html    — one page per chapter (multi-chapter only), with
 *                             back/prev/next nav
 *   worksheets/<slug>.html  — one page per worksheet (same as buildSite)
 *   build-info.json, .nojekyll
 *
 * All links are relative and resolve within _site/. Chapter pages live in
 * chapters/, so they reach the index via ../index.html and worksheets via
 * ../worksheets/<slug>.html.
 *
 * This is additive: buildSite (single-chapter callers) is untouched.
 */

import { md } from "orz-markdown";
import { rendererVersion } from "./index";
import { escapeHtml, themedDocument } from "./document";
import { learningResourceJsonLd, type LearningResourceMeta } from "./learning-resource";
import type { SiteFile, SiteWorksheet } from "./site";
import type { RenderTheme } from "./theme-css";

export interface CourseChapter {
  /** URL-safe slug; becomes chapters/<slug>.html. */
  slug: string;
  title: string;
  markdown: string;
}

export interface CourseSiteInput {
  title: string;
  chapters: CourseChapter[];
  worksheets?: SiteWorksheet[];
  /** ISO timestamp, passed in for deterministic builds. */
  builtAt: string;
  /** LRMI/schema.org metadata; when present, emitted as JSON-LD on the index (M30). */
  meta?: LearningResourceMeta;
  /** Render theme — matches the educator's editor selection (default dark). */
  theme?: RenderTheme;
}

/**
 * Worksheet nav fragment, with link paths relative to the page that hosts it.
 * `prefix` is "" for the root index and "../" for pages under chapters/.
 */
function worksheetNav(worksheets: SiteWorksheet[], prefix: string): string {
  if (!worksheets.length) return "";
  const items = worksheets
    .map(
      (w) =>
        `<li><a href="${prefix}worksheets/${w.slug}.html">${escapeHtml(
          w.title,
        )}</a></li>`,
    )
    .join("\n");
  return `<hr>\n<h2>Worksheets</h2>\n<ul>\n${items}\n</ul>`;
}

/** Build the static site file set for a multi-chapter course. */
export function buildCourseSite(input: CourseSiteInput): SiteFile[] {
  const files: SiteFile[] = [];
  const worksheets = input.worksheets ?? [];
  const chapters = input.chapters;
  const indexHead = input.meta ? learningResourceJsonLd(input.meta) : undefined;

  if (chapters.length > 1) {
    // Multi-chapter: index is a table of contents.
    const toc = chapters
      .map(
        (c) =>
          `<li><a href="chapters/${c.slug}.html">${escapeHtml(
            c.title,
          )}</a></li>`,
      )
      .join("\n");
    const wsNav = worksheetNav(worksheets, "");
    const indexBody = `<h1>${escapeHtml(
      input.title,
    )}</h1>\n<ul>\n${toc}\n</ul>${wsNav ? `\n${wsNav}` : ""}`;
    files.push({
      path: "index.html",
      content: themedDocument({ title: input.title, bodyHtml: indexBody, headHtml: indexHead, theme: input.theme }),
    });

    chapters.forEach((c, i) => {
      const back = `<p><a href="../index.html">← ${escapeHtml(
        input.title,
      )}</a></p>`;
      const prev = chapters[i - 1];
      const next = chapters[i + 1];
      const navParts: string[] = [];
      if (prev) {
        navParts.push(
          `<a href="${prev.slug}.html">← Previous: ${escapeHtml(
            prev.title,
          )}</a>`,
        );
      }
      if (next) {
        navParts.push(
          `<a href="${next.slug}.html">Next: ${escapeHtml(next.title)} →</a>`,
        );
      }
      const pagerNav = navParts.length
        ? `\n<hr>\n<nav class="chapter-nav">\n${navParts
            .map((p) => `<p>${p}</p>`)
            .join("\n")}\n</nav>`
        : "";
      // The chapter title is the page h1 (sourced from the manifest, not the
      // markdown — blocks are h2). Keeps title as the single source of truth.
      const body = `${back}\n<h1>${escapeHtml(c.title)}</h1>\n${md.render(
        c.markdown,
      )}${pagerNav}`;
      files.push({
        path: `chapters/${c.slug}.html`,
        content: themedDocument({ title: c.title, bodyHtml: body, theme: input.theme }),
      });
    });
  } else {
    // Single chapter (or none): render inline under the course title, mirroring
    // buildSite's single-page look. No separate chapters/ pages.
    const wsNav = worksheetNav(worksheets, "");
    const chapterHtml = chapters.length
      ? `\n${md.render(chapters[0]!.markdown)}`
      : "";
    const indexBody = `<h1>${escapeHtml(input.title)}</h1>${chapterHtml}${
      wsNav ? `\n${wsNav}` : ""
    }`;
    files.push({
      path: "index.html",
      content: themedDocument({ title: input.title, bodyHtml: indexBody, headHtml: indexHead, theme: input.theme }),
    });
  }

  // Worksheet pages (same shape for single- and multi-chapter).
  for (const w of worksheets) {
    const body = `<p><a href="../index.html">← ${escapeHtml(
      input.title,
    )}</a></p>\n<h1>${escapeHtml(w.title)}</h1>\n${md.render(w.markdown)}`;
    files.push({
      path: `worksheets/${w.slug}.html`,
      content: themedDocument({ title: w.title, bodyHtml: body, theme: input.theme }),
    });
  }

  files.push({
    path: "build-info.json",
    content:
      JSON.stringify(
        { generator: "Alembic", renderer: rendererVersion(), builtAt: input.builtAt },
        null,
        2,
      ) + "\n",
  });
  // Tell GitHub Pages to serve files as-is (no Jekyll processing).
  files.push({ path: ".nojekyll", content: "" });

  return files;
}
