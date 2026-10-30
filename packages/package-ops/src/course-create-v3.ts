/**
 * Create a v3 course's working repo (A1/A3; package-contract-v3 §1, R26):
 * one private repository, generated from the private template into the
 * owner's GitHub account through the owner's App installation, then one
 * commit with the v3 manifest and its first chapters (all at once for
 * someone who knows their table of contents). Every path is checked
 * against the working-repo rule before it is written.
 */
import {
  activeProfile,
  assertPathAllowedInWorkingRepo,
  newDocId,
  newPackageId,
  WorkingManifestV3Schema,
  type WorkingManifestV3,
} from "@alembic/package-contract";
import { addChapters, CHAPTER_PARTS, chapterPartPath, chapterPartText } from "./chapter-parts";

export { chapterSlug, firstStudyGuide } from "./chapter-parts";

export interface CourseRepoDeps {
  generateFromTemplate(i: { templateOwner: string; templateRepo: string; owner: string; name: string; private: boolean; description: string }): Promise<{ owner: string; repo: string }>;
  /** The branch head once the generated repo is ready (GitHub fills it shortly after the call). */
  waitForHead(coords: { owner: string; repo: string }): Promise<string>;
  commit(coords: { owner: string; repo: string }, i: { expectedHead: string; message: string; files: Array<{ path: string; content: string }> }): Promise<string>;
}

export interface NewCourse {
  title: string;
  owner: string;            // the GitHub account the App is installed on
  templateOwner: string;
  privateTemplate: string;
  license: WorkingManifestV3["license"];
  /** Chapter titles in order (blank ones skipped); none gives one "Introduction" chapter. */
  chapters?: string[];
  /** Start every chapter's five parts at once (otherwise only its study guide). */
  startParts?: boolean;
}

export function repoNameFor(title: string, packageId: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "course";
  return `${slug}-${packageId.slice(-6)}-private`;
}

export async function createCourseRepoV3(n: NewCourse, deps: CourseRepoDeps): Promise<{
  packageId: string; manifest: WorkingManifestV3; repo: { owner: string; name: string }; head: string; files: string[];
}> {
  const packageId = newPackageId(n.title);
  const empty = WorkingManifestV3Schema.parse({ schemaVersion: 3, packageId, title: n.title, license: n.license, createdAt: new Date().toISOString(), chapters: [] });
  const titles = (n.chapters ?? []).filter((t) => t.trim());
  const { manifest, added } = addChapters(empty, titles.length ? titles : ["Introduction"]);
  const files = [{ path: "alembic.json", content: `${JSON.stringify(manifest, null, 2)}\n` }];
  for (const ch of added) {
    for (const { part } of CHAPTER_PARTS) {
      if (n.startParts || activeProfile.requiredParts.includes(part)) files.push({ path: chapterPartPath(part, ch.slug), content: chapterPartText(part, ch.title, newDocId()) });
    }
  }
  for (const f of files) assertPathAllowedInWorkingRepo(f.path);

  const coords = await deps.generateFromTemplate({
    templateOwner: n.templateOwner, templateRepo: n.privateTemplate, owner: n.owner,
    name: repoNameFor(n.title, packageId), private: true, description: `Alembic course: ${n.title}`.slice(0, 300),
  });
  const base = await deps.waitForHead(coords);
  const head = await deps.commit(coords, { expectedHead: base, message: `Create course “${n.title}”`, files });
  return { packageId, manifest, repo: { owner: coords.owner, name: coords.repo }, head, files: files.map((f) => f.path) };
}
