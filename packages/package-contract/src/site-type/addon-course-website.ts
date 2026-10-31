/**
 * The course-website add-on (Alembic docs/specs/v3/course-website-addon.md): a home page, a per-term "This semester"
 * folder for any files (recommended pages offered as starters), and a private Exams folder. A small side package
 * within Alembic (owner, 2026-10-30), kept as data. Pure.
 */
export const COURSE_WEBSITE = "course-website";

export const HOME_PAGE = "home.md";
export const TERM_ROOT = "current";
export const EXAMS_FOLDER = "private/exams";

/** The recommended term pages, offered as one-click starters (nothing is required). */
export const TERM_STARTERS: ReadonlyArray<{ id: string; label: string; file: string; body: string }> = [
  { id: "syllabus", label: "Syllabus", file: "syllabus.md", body: "## Course description\n\n## Learning goals\n\n## Materials\n\n## Grading\n\n## Policies\n" },
  { id: "schedule", label: "Schedule", file: "schedule.md", body: "| Week | Dates | Topics | Readings | Due |\n|---|---|---|---|---|\n| 1 |  |  |  |  |\n" },
  { id: "announcements", label: "Announcements", file: "announcements.md", body: "Newest first.\n\n## Welcome\n\n" },
  { id: "assignments", label: "Assignments", file: "assignments.md", body: "| Assignment | Due | Notes |\n|---|---|---|\n|  |  |  |\n" },
  { id: "office-hours", label: "Office hours", file: "office-hours.md", body: "| Who | When | Where |\n|---|---|---|\n|  |  |  |\n" },
];

const oneLine = (t: string) => t.replace(/\}\}/g, "} }").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
const page = (title: string, uid: string, body: string) => `{{nyml\nkind: document\nformat: 1\ntitle: ${oneLine(title)}\nuid: ${uid}\n}}\n\n# ${oneLine(title)}\n\n${body}`;

export function homePageStarter(courseTitle: string, uid: string): string {
  return page(courseTitle || "Welcome", uid, "Welcome to the course. Say who it is for, how to use these materials, and where to start.\n\nThis semester's syllabus, schedule and announcements are listed below.\n");
}
export function termPageStarter(label: string, termTitle: string, uid: string, body = ""): string {
  return page(`${label} — ${termTitle}`, uid, body);
}

/** A term's slug from its title ("Fall 2026" → "fall-2026"). */
export function termSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "term";
}

/** The term folder of a term. */
export const termFolder = (slug: string) => `${TERM_ROOT}/${slug}/`;

/** The term a path belongs to (`current/<slug>/…`), if any. */
export function termOfPath(path: string): string | null {
  const m = /^current\/([a-z0-9]+(?:-[a-z0-9]+)*)\//.exec(path);
  return m ? m[1]! : null;
}

/**
 * Does the add-on let this file go to the website (K1.30)? Files outside the add-on's places: yes (decided by status
 * as usual). The home page: only with the add-on on. Term files: only with it on and only in the current term.
 */
export function addonAllowsPublish(path: string, m: { addons?: readonly string[]; terms?: ReadonlyArray<{ slug: string }> | undefined; currentTerm?: string | undefined }): boolean {
  const on = m.addons?.includes(COURSE_WEBSITE) === true;
  if (path === HOME_PAGE) return on;
  // Only the folders of the course's own terms are the add-on's; anything else under current/ (a course's older
  // files) is an ordinary file (round 1 audit L3).
  const term = termOfPath(path);
  if (!term || !(m.terms ?? []).some((t) => t.slug === term)) return true;
  return on && term === m.currentTerm;
}
