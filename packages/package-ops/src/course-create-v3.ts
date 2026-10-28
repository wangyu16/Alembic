/**
 * Create a v3 course's working repo (A1/A3; package-contract-v3 §1, R26):
 * one private repository, generated from the private template into the
 * owner's GitHub account through the owner's App installation, then one
 * commit with the v3 manifest and a first chapter. Every path is checked
 * against the working-repo rule before it is written.
 */
import {
  assertPathAllowedInWorkingRepo,
  newDocId,
  newPackageId,
  WorkingManifestV3Schema,
  type WorkingManifestV3,
} from "@alembic/package-contract";

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
  firstChapter?: string;    // title of the first chapter
}

export function repoNameFor(title: string, packageId: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "course";
  return `${slug}-${packageId.slice(-6)}-private`;
}

export function chapterSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chapter-1";
}

/** The first chapter's study guide, with its FC-18 header. */
export function firstStudyGuide(chapterTitle: string, uid: string): string {
  const title = chapterTitle.replace(/\}\}/g, "} }").replace(/[\r\n]+/g, " ");
  return `{{nyml\nkind: document\nformat: 1\ntitle: ${title}\nuid: ${uid}\n}}\n\n# ${title}\n\nStart writing here.\n`;
}

export async function createCourseRepoV3(n: NewCourse, deps: CourseRepoDeps): Promise<{
  packageId: string; manifest: WorkingManifestV3; repo: { owner: string; name: string }; head: string; files: string[];
}> {
  const packageId = newPackageId(n.title);
  const chapterTitle = n.firstChapter?.trim() || "Introduction";
  const slug = chapterSlug(chapterTitle);
  const manifest = WorkingManifestV3Schema.parse({
    schemaVersion: 3,
    packageId,
    title: n.title,
    license: n.license,
    createdAt: new Date().toISOString(),
    chapters: [{ slug, title: chapterTitle, mode: "draft" }],
  });
  const files = [
    { path: "alembic.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: `study-guide/${slug}.md`, content: firstStudyGuide(chapterTitle, newDocId()) },
  ];
  for (const f of files) assertPathAllowedInWorkingRepo(f.path);

  const coords = await deps.generateFromTemplate({
    templateOwner: n.templateOwner, templateRepo: n.privateTemplate, owner: n.owner,
    name: repoNameFor(n.title, packageId), private: true, description: `Alembic course: ${n.title}`.slice(0, 300),
  });
  const base = await deps.waitForHead(coords);
  const head = await deps.commit(coords, { expectedHead: base, message: `Create course “${n.title}”`, files });
  return { packageId, manifest, repo: { owner: coords.owner, name: coords.repo }, head, files: files.map((f) => f.path) };
}
