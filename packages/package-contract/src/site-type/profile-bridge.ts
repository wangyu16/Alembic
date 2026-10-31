/**
 * The bridge from a site type definition (family docs/SITE-TYPE-CONTRACT.md)
 * to the `ContentProfile` Alembic's core reads today (FD-10). It lets the
 * definition replace the hand-written Coursewerk profile without changing the
 * core in the same step; later steps make the core read the definition
 * directly and remove the bridge (contract §14). Pure.
 *
 * Bridge-only behaviour, removed with those steps (each marked BRIDGE):
 * - documents never combined (`edits: keep-both`) are the "plan" class, so
 *   today's course-plan approval keeps working until it is removed;
 * - `current/` and `metadata/` stay placed until the testing copy is migrated;
 * - a file in a document folder that matches no document or unit folder is
 *   still "material", as today.
 */
import { PACKAGE_SPACES, type PackageSpace } from "../spaces";
import type { ContentProfile, MediaKind, PathClass, UnitPart } from "../profile/types";
import { type SiteType } from "./schema";
import { EXAMS_FOLDER, HOME_PAGE, TERM_ROOT } from "./addon-course-website";

/** The figure kinds Alembic accepts (contract §8: Alembic's list, not the type package's). */
const MEDIA: Readonly<Record<string, MediaKind>> = { png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif", webp: "webp", svg: "svg" };

/** BRIDGE: folders a site already holds that the definition no longer places, until the migration moves them. */
const LEGACY_FOLDERS: Readonly<Record<string, { space: PackageSpace; cls: PathClass }>> = {
  current: { space: "current", cls: "material" },
  metadata: { space: "metadata", cls: "project-file" },
};

/** One line, safe inside a document header and a heading (as the hand-written profile did). */
const oneLine = (t: string, fallback: string) => t.replace(/\}\}/g, "} }").replace(/[\r\n]+/g, " ").trim().slice(0, 200) || fallback;

/** Fill a starter's `{{title}}` and `{{uid}}` (contract §5 `starter`). */
export function fillStarter(text: string, title: string, uid: string, fallback = "Untitled chapter"): string {
  const t = oneLine(title, fallback);
  const u = uid.replace(/[^A-Za-z0-9_-]/g, "");
  return text.split("{{title}}").join(t).split("{{uid}}").join(u);
}

const under = (path: string, folder: string) => path === folder || path.startsWith(`${folder.replace(/\/$/, "")}/`);
const topDir = (p: string) => p.split("/")[0]!;
/** The fixed text before and after `{unit}` in a pattern. */
const around = (pattern: string, ph: string) => { const [pre, post] = pattern.split(`{${ph}}`) as [string, string]; return { pre, post }; };

/** The `{doc}` value for a page (contract §5): a declared document's file stem, or the whole path joined with `--`. */
export function docKey(def: SiteType, docPath: string): string {
  const declared = def.documents.some((d) => {
    if (d.scope === "site") return d.path === docPath;
    const { pre, post } = around(d.path, "unit");
    return docPath.startsWith(pre) && docPath.endsWith(post) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(docPath.slice(pre.length, docPath.length - post.length));
  });
  const noEnding = docPath.replace(/\.(slides|paged)\.md$/i, "").replace(/\.md$/i, "");
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (declared) return slug(noEnding.split("/").pop() ?? "") || "document";
  return noEnding.split("/").map(slug).filter(Boolean).join("--") || "document";
}

export function profileFromDefinition(def: SiteType, files: Readonly<Record<string, string>>): ContentProfile {
  const unitDocs = def.documents.filter((d) => d.scope === "unit");
  const siteDocs = def.documents.filter((d) => d.scope === "site");
  const starterOf = (file: string | undefined) => (file ? files[file] : undefined);

  const parts: UnitPart[] = unitDocs.map((d) => {
    const { pre, post } = around(d.path, "unit");
    const starter = starterOf(d.starter);
    return {
      id: d.id,
      label: d.label,
      path: (slug: string) => `${pre}${slug}${post}`,
      published: true,
      plan: d.edits === "keep-both", // BRIDGE
      starter: (title: string, uid: string) => (starter !== undefined ? fillStarter(starter, title, uid) : `{{nyml\nkind: document\nformat: 1\ntitle: ${oneLine(title, "Untitled chapter")}\nuid: ${uid}\n}}\n`),
    };
  });

  // Top-level folders and their spaces (the core's space type is fixed until it reads the definition directly).
  const folders: Record<string, PackageSpace> = {};
  const addFolder = (dir: string) => {
    if (dir === "" || folders[dir]) return;
    if (!(PACKAGE_SPACES as readonly string[]).includes(dir)) throw new Error(`site type ${def.type}: folder "${dir}" has no space in Alembic's core yet`);
    folders[dir] = dir as PackageSpace;
  };
  for (const d of def.documents) if (d.path.includes("/")) addFolder(topDir(d.path));
  for (const f of def.unitFolders ?? []) addFolder(topDir(f.path));
  for (const f of def.folders ?? []) addFolder(topDir(f.path));
  if (def.figures) addFolder(topDir(def.figures.public));
  if (def.records) addFolder(topDir(def.records.public));
  addFolder("private");
  for (const [dir, l] of Object.entries(LEGACY_FOLDERS)) folders[dir] = l.space; // BRIDGE

  const licenceFiles = new Set<string>();
  for (const c of def.licences?.choices ?? []) for (const n of Object.keys(c.files)) licenceFiles.add(n);
  if (def.licences?.citation) licenceFiles.add(def.licences.citation.file);
  const rootFiles = [
    "alembic.json", ".gitignore", // Alembic's own (contract §4)
    ...siteDocs.filter((d) => !d.path.includes("/")).map((d) => d.path),
    ...licenceFiles,
    ...(def.rootFiles ?? []).map((r) => r.name),
    HOME_PAGE, // the course-website add-on's home page (course-website-addon §5: accepted in every course, interim)
  ];

  const fixedPrivateFiles = (def.private ?? []).filter((p) => p.who === "fixed" && /\.[a-z0-9]+$/i.test(p.path)).map((p) => p.path);
  const privateSubfolders = new Set<string>(["sources"]); // private/sources/ is Alembic's own (contract §4)
  for (const p of def.private ?? []) if (!fixedPrivateFiles.includes(p.path)) privateSubfolders.add(p.path.split("/")[1]!);
  if (def.records) privateSubfolders.add(def.records.private.split("/")[1]!);
  if (def.figures) privateSubfolders.add(def.figures.private.split("/")[1]!);
  privateSubfolders.add(EXAMS_FOLDER.split("/")[1]!); // the add-on's private Exams folder

  // Reserved slugs: a slug equal to the unit part of a site document's path that matches a unit pattern.
  const reserved = new Set<string>();
  for (const s of siteDocs) for (const u of unitDocs) {
    const { pre, post } = around(u.path, "unit");
    if (s.path.startsWith(pre) && s.path.endsWith(post)) reserved.add(s.path.slice(pre.length, s.path.length - post.length));
  }

  const docClass = (path: string): PathClass | null => {
    for (const d of siteDocs) if (d.path === path) return d.edits === "keep-both" ? "plan" : d.who === "lead" || d.who === "fixed" ? "project-file" : "material";
    for (const d of unitDocs) {
      const { pre, post } = around(d.path, "unit");
      if (path.startsWith(pre) && path.endsWith(post) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path.slice(pre.length, path.length - post.length))) {
        return d.edits === "keep-both" ? "plan" : d.who === "lead" || d.who === "fixed" ? "project-file" : "material"; // BRIDGE: keep-both is "plan"
      }
    }
    for (const f of def.unitFolders ?? []) if (path.startsWith(around(f.path, "unit").pre)) return "material";
    return null;
  };
  const docTopDirs = new Set([...unitDocs.map((d) => topDir(d.path)), ...(def.unitFolders ?? []).map((f) => topDir(f.path))]);
  const planTopDirs = new Set(unitDocs.filter((d) => d.edits === "keep-both").map((d) => topDir(d.path)));

  return {
    id: def.type,
    version: def.version,
    rootFiles,
    folders,
    serverOnlyFiles: fixedPrivateFiles,
    privateSubfolders: [...privateSubfolders],
    recordsFolders: def.records ? [def.records.private, def.records.public].map((f) => f.replace(/\/$/, "")) : [],
    reservedUnitSlugs: [...reserved],
    unitParts: parts,
    requiredParts: unitDocs.filter((d) => d.required).map((d) => d.id),
    figureFolder(docPath: string): string {
      const key = docKey(def, docPath);
      const pattern = docPath.startsWith("private/") ? def.figures?.private ?? "private/instructor/figures/{doc}" : def.figures?.public ?? "assets/{doc}";
      return pattern.replace("{doc}", key);
    },
    media: MEDIA,
    licences: {
      allowed: (def.licences?.choices ?? []).map((c) => c.id),
      open: (def.licences?.choices ?? []).filter((c) => c.open).map((c) => c.id),
    },
    pathClass(path: string, space: PackageSpace): PathClass {
      if (path === "alembic.json") return "settings";
      // The course-website add-on's places: editors write them (course-website-addon §1).
      if (path === HOME_PAGE || path.startsWith(`${TERM_ROOT}/`)) return "material";
      if (path.startsWith(`${EXAMS_FOLDER}/`)) return "private-editable";
      // Both records folders: only the type package's tools write them, through the hand-in (agent-runtime §15).
      if (def.records && (under(path, def.records.private) || under(path, def.records.public))) return "records";
      const doc = docClass(path);
      if (doc) return doc;
      if (!path.includes("/")) return "project-file";
      if (space === "private") {
        const entry = (def.private ?? []).find((p) => under(path, p.path));
        if (def.figures && under(path, def.figures.private.split("/{doc}")[0]!)) return "private-editable";
        return entry?.who === "editor" ? "private-editable" : "private-protected";
      }
      const folder = (def.folders ?? []).find((f) => under(path, f.path));
      if (folder) return folder.who === "editor" ? "material" : "project-file";
      const legacy = LEGACY_FOLDERS[topDir(path)];
      if (legacy) return legacy.cls; // BRIDGE
      if (planTopDirs.has(topDir(path))) return "plan"; // BRIDGE: as today
      if (docTopDirs.has(topDir(path))) return "material"; // BRIDGE: as today
      return "project-file";
    },
    unitProblems(units, present) {
      const required = parts.filter((p) => this.requiredParts.includes(p.id));
      const out: string[] = [];
      for (const u of units) for (const p of required) if (!present.has(p.path(u.slug))) out.push(`Chapter “${u.title}” has no ${p.label.toLowerCase()}.`);
      return out;
    },
  };
}
