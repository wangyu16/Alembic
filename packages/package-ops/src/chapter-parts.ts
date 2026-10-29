/**
 * Adding chapters and starting their parts (no agent needed). Pure. The parts
 * and their starter texts are the content profile's (FD-10: Coursewerk's,
 * FD-09); this module only applies them.
 */
import { activeProfile, assertPathAllowedInWorkingRepo, firstStudyGuide, isReservedChapterSlug, WorkingManifestV3Schema, type WorkingManifestV3 } from "@alembic/package-contract";

export { firstStudyGuide };

export function chapterSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chapter-1";
}


/** At most this many chapters are added in one go. */
export const MAX_NEW_CHAPTERS = 30;

/**
 * Add chapters (one title each, in order) to the end of the course, as drafts. Slugs come from the titles and
 * never collide with an existing or reserved one. Blank lines are skipped; titles are kept on one line.
 */
export function addChapters(m: WorkingManifestV3, titles: string[]): { manifest: WorkingManifestV3; added: Array<{ slug: string; title: string }> } {
  const taken = new Set(m.chapters.map((c) => c.slug));
  const added: Array<{ slug: string; title: string }> = [];
  for (const raw of titles) {
    const title = raw.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) continue;
    if (added.length >= MAX_NEW_CHAPTERS) throw new RangeError(`at most ${MAX_NEW_CHAPTERS} chapters at a time`);
    const stem = chapterSlug(title).slice(0, 55).replace(/-+$/, "") || "chapter";
    let slug = isReservedChapterSlug(stem) ? `${stem}-chapter` : stem;
    for (let n = 2; taken.has(slug); n++) slug = `${stem}-${n}`;
    taken.add(slug);
    added.push({ slug, title });
  }
  const manifest = WorkingManifestV3Schema.parse({ ...m, chapters: [...m.chapters, ...added.map((a) => ({ ...a, mode: "draft" as const }))] });
  return { manifest, added };
}

/** A part of a chapter, by the content profile's part id (FD-10). */
export type ChapterPart = string;

/** The chapter's parts, in order, from the active content profile. */
export const CHAPTER_PARTS: ReadonlyArray<{ part: ChapterPart; label: string }> = activeProfile.unitParts.map((p) => ({ part: p.id, label: p.label }));

function partOf(part: ChapterPart) {
  const p = activeProfile.unitParts.find((x) => x.id === part);
  if (!p) throw new RangeError(`no chapter part "${part}"`);
  return p;
}

export function chapterPartPath(part: ChapterPart, slug: string): string {
  const path = partOf(part).path(slug);
  assertPathAllowedInWorkingRepo(path);
  return path;
}

export function chapterPartText(part: ChapterPart, chapterTitle: string, uid: string): string {
  return partOf(part).starter(chapterTitle, uid);
}
