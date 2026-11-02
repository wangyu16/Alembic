/**
 * The course page as a course (RC.14): chapters in the course's own order
 * with their titles, each with its parts by name; then course-wide files and
 * instructor-only files. Pure: from the manifest's chapters and the paths of
 * the documents in the working tree.
 */
import { activeProfile } from "@alembic/package-contract";
// The chapter's parts are the content profile's (FD-10).
const PARTS: ReadonlyArray<{ label: string; path: (slug: string) => string }> = activeProfile.unitParts.map((p) => ({ label: p.label, path: p.path }));

export interface OutlineLink { label: string; path: string }
export interface Outline {
  chapters: Array<{ slug: string; title: string; draft: boolean; parts: OutlineLink[]; missing: string[]; more: OutlineLink[] }>;
  course: OutlineLink[];
  instructor: OutlineLink[];
}

const nice = (path: string) => {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.(slides|paged)\.md$/i, " ($1)").replace(/\.md$/i, "").replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
};

export function courseOutline(chapters: ReadonlyArray<{ slug: string; title: string; mode?: string }>, docs: readonly string[]): Outline {
  const left = new Set(docs);
  const out: Outline = { chapters: [], course: [], instructor: [] };
  for (const ch of chapters) {
    const parts: OutlineLink[] = [];
    const missing: string[] = [];
    for (const p of PARTS) {
      const path = p.path(ch.slug);
      if (left.delete(path)) parts.push({ label: p.label, path }); else missing.push(p.label);
    }
    const more = [...left].filter((d) => d.split("/")[1] === "chapters" && d.split("/")[2] === ch.slug).sort();
    for (const d of more) left.delete(d);
    out.chapters.push({ slug: ch.slug, title: ch.title, draft: ch.mode === "draft", parts, missing, more: more.map((path) => ({ label: nice(path), path })) });
  }
  for (const d of [...left].sort()) {
    if (d.startsWith("private/")) out.instructor.push({ label: nice(d), path: d });
    else out.course.push({ label: d === "concepts/course.md" ? "Course map" : nice(d), path: d });
  }
  return out;
}
