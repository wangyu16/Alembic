import { CHAPTER_SLUG_PATTERN } from "@alembic/package-contract";

/**
 * "What's inside" on a course page links each chapter to its page on the
 * course's student site (blind-critique 2026-10-26). The discovery index
 * carries chapter TITLES only; the slugs come from the same manifest the
 * titles were projected from (`chapters[].slug`, in order). The student site
 * serves a chapter at `chapters/{slug}.md.html` (the site build,
 * `site-actions.ts`). Pure; tested in `course-chapter-links.test.ts`.
 *
 * A link is offered only when it can be trusted: the site URL is an https
 * address, the manifest's chapters line up one-to-one with the projected
 * titles (same count, same titles), and every slug is a contract slug.
 * Otherwise the list stays plain text.
 */
export function chapterLinks(
  siteUrl: string | null | undefined,
  titles: readonly string[],
  manifestChapters: unknown,
): Array<string | null> {
  const none = titles.map(() => null);
  let base: URL;
  try {
    base = new URL(siteUrl ?? "");
  } catch {
    return none;
  }
  if (base.protocol !== "https:") return none;
  if (!Array.isArray(manifestChapters) || manifestChapters.length !== titles.length) return none;
  const slugs: string[] = [];
  for (let i = 0; i < manifestChapters.length; i++) {
    const c = manifestChapters[i] as { slug?: unknown; title?: unknown } | null;
    if (!c || typeof c.slug !== "string" || !CHAPTER_SLUG_PATTERN.test(c.slug)) return none;
    if (typeof c.title !== "string" || c.title.trim().slice(0, 200) !== titles[i]) return none;
    slugs.push(c.slug);
  }
  const root = base.href.endsWith("/") ? base.href : `${base.href}/`;
  return slugs.map((s) => `${root}chapters/${s}.md.html`);
}
