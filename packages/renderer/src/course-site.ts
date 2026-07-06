/**
 * Multi-chapter static-site builder (Module S): renders a course into an HTML
 * file set for GitHub Pages, using the shared themed document.
 *
 * Information architecture (S1) — reading-first, ≤2 clicks to anything:
 *   index.html              — course home: title + intro + chapter cards (each
 *                             linking its page and its offline download) +
 *                             optional practice; single-chapter renders inline
 *   chapters/<slug>.html    — one reading page per chapter (multi-chapter), with
 *                             a resource bar (offline download) + prev/next nav
 *   worksheets/<slug>.html  — one practice page per worksheet
 *   downloads/<slug>.md.html — self-contained chapter file (added by the caller;
 *                             this module only LINKS it via `downloadHref`)
 *   build-info.json, .nojekyll
 *
 * Reading chrome (a slim top nav, chapter cards, resource bar, footer) is added
 * via a small theme-neutral stylesheet so it sits cleanly on either orz theme.
 * All links are relative; `prefix` ("" at root, "../" under chapters/ and
 * worksheets/) resolves root-relative hrefs per page.
 *
 * This is additive: buildSite (single-page callers) is untouched.
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
  /** Root-relative href of this chapter's self-contained offline download
   *  (e.g. "downloads/<slug>.md.html"), when the caller built one. */
  downloadHref?: string;
}

export interface CourseSiteInput {
  title: string;
  /** Short course intro shown on the home page (markdown). */
  description?: string;
  chapters: CourseChapter[];
  worksheets?: SiteWorksheet[];
  /** ISO timestamp, passed in for deterministic builds. */
  builtAt: string;
  /** LRMI/schema.org metadata; when present, emitted as JSON-LD on the index (M30). */
  meta?: LearningResourceMeta;
  /** Render theme — matches the educator's editor selection (default dark). */
  theme?: RenderTheme;
}

/** Theme-neutral reading chrome (greys via opacity, so it fits dark or light). */
const SITE_STYLE = `<style>
.site-nav{display:flex;gap:1rem;align-items:center;font-size:.9rem;opacity:.75;margin-bottom:2rem;padding-bottom:.9rem;border-bottom:1px solid rgba(128,128,128,.25)}
.site-nav a{text-decoration:none}
.course-intro{opacity:.85}
.chapter-cards{list-style:none;padding:0;margin:1.5rem 0;display:grid;gap:.75rem}
.chapter-cards li{border:1px solid rgba(128,128,128,.28);border-radius:.6rem;padding:.85rem 1.1rem}
.chapter-cards .chapter-link{font-weight:600;text-decoration:none;font-size:1.1rem}
.chapter-cards .card-links{display:block;margin-top:.35rem;font-size:.82rem;opacity:.75}
.resource-bar{display:flex;flex-wrap:wrap;gap:.6rem;margin:1.1rem 0 1.8rem;padding:.7rem 0;border-top:1px solid rgba(128,128,128,.2);border-bottom:1px solid rgba(128,128,128,.2)}
.resource-bar a,.copy-src{display:inline-flex;align-items:center;gap:.4rem;font-size:.85rem;text-decoration:none;border:1px solid rgba(128,128,128,.32);border-radius:.5rem;padding:.35rem .75rem}
.copy-src{cursor:pointer;background:none;color:inherit;font-family:inherit}
.chapter-nav{display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;font-size:.9rem;margin-top:2.5rem;padding-top:1rem;border-top:1px solid rgba(128,128,128,.25)}
.site-footer{margin-top:3rem;padding-top:1rem;border-top:1px solid rgba(128,128,128,.2);font-size:.8rem;opacity:.6}
</style>`;

/**
 * Copy-as-source (S2): every content page carries its Markdown in a hidden
 * textarea (entity-escaped, so it can't break out) and a small button to copy
 * it. Reading pages are static, so this is the whole runtime — a few lines.
 */
const COPY_SCRIPT = `<script>document.querySelectorAll('.copy-src').forEach(function(b){b.addEventListener('click',function(){var t=document.getElementById(b.getAttribute('data-src'));if(!t)return;navigator.clipboard.writeText(t.value).then(function(){var o=b.textContent;b.textContent='Copied!';setTimeout(function(){b.textContent=o;},1500);});});});</script>`;

const COPY_BUTTON = `<button type="button" class="copy-src" data-src="page-source" title="Copy this page's Markdown source">⧉ Copy as Markdown</button>`;

/** Hidden source + copy script appended after a content page's body. */
function sourceTrailing(markdown: string): string {
  return `<textarea id="page-source" hidden>${escapeHtml(markdown)}</textarea>\n${COPY_SCRIPT}`;
}

/** Combine the reading-chrome style with any extra head HTML (e.g. JSON-LD). */
function head(extra?: string): string {
  return extra ? `${SITE_STYLE}\n${extra}` : SITE_STYLE;
}

/** A root-relative href resolved for a page at the given `prefix`. */
function at(prefix: string, href: string): string {
  return `${prefix}${href}`;
}

/** Top nav: home link back to the course (omitted on the home page itself). */
function topNav(title: string, prefix: string, home: boolean): string {
  if (home) return "";
  return `<nav class="site-nav"><a href="${at(prefix, "index.html")}">← ${escapeHtml(
    title,
  )}</a></nav>`;
}

function footer(): string {
  return `<footer class="site-footer">Published with Alembic</footer>`;
}

/**
 * Practice nav fragment, links relative to the hosting page.
 * `prefix` is "" for the root index and "../" for pages under chapters/.
 */
function worksheetNav(worksheets: SiteWorksheet[], prefix: string): string {
  if (!worksheets.length) return "";
  const items = worksheets
    .map(
      (w) =>
        `<li><a href="${at(prefix, `worksheets/${w.slug}.html`)}">${escapeHtml(w.title)}</a></li>`,
    )
    .join("\n");
  return `<hr>\n<h2>Practice</h2>\n<ul>\n${items}\n</ul>`;
}

/** Offline-download link for a chapter, resolved for the hosting page. */
function downloadLink(ch: CourseChapter, prefix: string): string {
  if (!ch.downloadHref) return "";
  return `<a href="${at(prefix, ch.downloadHref)}" download>⬇ Download this ${escapeHtml(
    "chapter",
  )} (offline copy)</a>`;
}

/** Build the static site file set for a multi-chapter course. */
export function buildCourseSite(input: CourseSiteInput): SiteFile[] {
  const files: SiteFile[] = [];
  const worksheets = input.worksheets ?? [];
  const chapters = input.chapters;
  const indexHead = head(input.meta ? learningResourceJsonLd(input.meta) : undefined);
  const intro = input.description
    ? `<div class="course-intro">${md.render(input.description)}</div>`
    : "";

  if (chapters.length > 1) {
    // Multi-chapter: the home page is a set of chapter cards.
    const cards = chapters
      .map((c) => {
        const dl = c.downloadHref
          ? `<span class="card-links"><a href="${escapeHtml(c.downloadHref)}" download>Download offline copy</a></span>`
          : "";
        return `<li><a class="chapter-link" href="chapters/${c.slug}.html">${escapeHtml(
          c.title,
        )}</a>${dl}</li>`;
      })
      .join("\n");
    const wsNav = worksheetNav(worksheets, "");
    const indexBody = `<h1>${escapeHtml(input.title)}</h1>${intro ? `\n${intro}` : ""}
<ul class="chapter-cards">\n${cards}\n</ul>${wsNav ? `\n${wsNav}` : ""}\n${footer()}`;
    files.push({
      path: "index.html",
      content: themedDocument({ title: input.title, bodyHtml: indexBody, headHtml: indexHead, theme: input.theme }),
    });

    chapters.forEach((c, i) => {
      const prev = chapters[i - 1];
      const next = chapters[i + 1];
      const navParts: string[] = [];
      if (prev) navParts.push(`<a href="${prev.slug}.html">← ${escapeHtml(prev.title)}</a>`);
      else navParts.push("<span></span>");
      if (next) navParts.push(`<a href="${next.slug}.html">${escapeHtml(next.title)} →</a>`);
      const pagerNav = `\n<nav class="chapter-nav">\n${navParts
        .map((p) => p)
        .join("\n")}\n</nav>`;
      const dl = downloadLink(c, "../");
      const resourceBar = `\n<div class="resource-bar">${dl}${dl ? " " : ""}${COPY_BUTTON}</div>`;
      // The chapter title is the page h1 (from the manifest, not the markdown —
      // blocks are h2). Keeps title as the single source of truth.
      const body = `${topNav(input.title, "../", false)}\n<h1>${escapeHtml(
        c.title,
      )}</h1>${resourceBar}\n${md.render(c.markdown)}${pagerNav}\n${footer()}`;
      files.push({
        path: `chapters/${c.slug}.html`,
        content: themedDocument({
          title: c.title,
          bodyHtml: body,
          headHtml: head(),
          theme: input.theme,
          trailingHtml: sourceTrailing(c.markdown),
        }),
      });
    });
  } else {
    // Single chapter (or none): render inline under the course title.
    const c = chapters[0];
    const dl = c ? downloadLink(c, "") : "";
    const resourceBar = c ? `\n<div class="resource-bar">${dl}${dl ? " " : ""}${COPY_BUTTON}</div>` : "";
    const chapterHtml = c ? `${resourceBar}\n${md.render(c.markdown)}` : "";
    const wsNav = worksheetNav(worksheets, "");
    const indexBody = `<h1>${escapeHtml(input.title)}</h1>${intro ? `\n${intro}` : ""}${chapterHtml}${
      wsNav ? `\n${wsNav}` : ""
    }\n${footer()}`;
    files.push({
      path: "index.html",
      content: themedDocument({
        title: input.title,
        bodyHtml: indexBody,
        headHtml: indexHead,
        theme: input.theme,
        // Single-chapter home renders the chapter inline → copy-as-source here.
        trailingHtml: c ? sourceTrailing(c.markdown) : undefined,
      }),
    });
  }

  // Practice pages (same shape for single- and multi-chapter).
  for (const w of worksheets) {
    const body = `${topNav(input.title, "../", false)}\n<h1>${escapeHtml(
      w.title,
    )}</h1>\n<div class="resource-bar">${COPY_BUTTON}</div>\n${md.render(w.markdown)}\n${footer()}`;
    files.push({
      path: `worksheets/${w.slug}.html`,
      content: themedDocument({
        title: w.title,
        bodyHtml: body,
        headHtml: head(),
        theme: input.theme,
        trailingHtml: sourceTrailing(w.markdown),
      }),
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
