/**
 * Bringing a course made outside Alembic in, as a new course (a type package's delivery, e.g. Coursewerk's
 * site-layout-3 package with SHA256SUMS): every file is checked as any write to a course is checked, and the result
 * is planned as one first commit. Pure: the caller reads the folder and makes the repository.
 *
 * - The checksum list, when given, must match every file and list no file that is missing (fail closed).
 * - Every path must be one the course's site type places, and of a kind a course can hold; pictures must be what
 *   they say; SVG figures must pass the SVG check; nothing may exceed the upload limit.
 * - Alembic's own files (alembic.json is rebuilt; .github/, .alembic/, private/sources/) are never taken from a package.
 * - Every page starts as a draft: the type package's list of ready pages is returned as a suggestion, never applied.
 */
import { createHash } from "node:crypto";
import {
  activeProfile,
  assertPathAllowedInWorkingRepo,
  DEFAULT_SITE_TYPE,
  fileKind,
  isPage,
  isTextBytes,
  MAX_UPLOAD_BYTES,
  mediaProblems,
  normalizePath,
  spaceForPathV3,
  svgProblems,
  unitPartForPath,
  WorkingManifestV3Schema,
  type WorkingManifestV3,
} from "@alembic/package-contract";

export interface ImportInput {
  /** Every file of the package (path → bytes), paths relative to its root. */
  files: ReadonlyMap<string, Uint8Array>;
  /** `SHA256SUMS` lines (`<hex>  ./path`), if the package came with them. */
  sums?: string | null;
  /** The new course's id and owner-facing settings; chapters come from the package's alembic.json when present. */
  packageId: string;
  title?: string;
  license?: string;
  /** Paths the type package says are ready (a suggestion shown to the owner). */
  ready?: readonly string[];
}

export interface ImportPlan {
  manifest: WorkingManifestV3;
  /** Files for the first commit (text as text, the rest as bytes). alembic.json included. */
  files: Array<{ path: string; text: string } | { path: string; bytes: Uint8Array }>;
  /** Pages the type package suggests are ready (only pages that are in the plan). */
  suggestedCompleted: string[];
  /** Paths left out, each with a plain reason. */
  leftOut: Array<{ path: string; why: string }>;
}

const ALEMBIC_OWN = (p: string) => p === "alembic.json" || p.startsWith(".github/") || p.startsWith(".alembic/") || p === ".gitignore" || p.startsWith("private/sources/");
const HIDDEN = (p: string) => p.split("/").some((seg) => seg.startsWith(".")) && p !== ".gitignore";

export type ImportResult = { ok: true; plan: ImportPlan } | { ok: false; problems: string[] };

export function planCourseImport(i: ImportInput): ImportResult {
  const problems: string[] = [];
  // 1. Checksums: every listed file present and matching; every file listed (fail closed).
  if (i.sums != null) {
    const listed = new Map<string, string>();
    for (const line of i.sums.split("\n")) {
      const m = /^([0-9a-f]{64})\s+\*?(?:\.\/)?(.+)$/.exec(line.trim());
      if (m) listed.set(m[2]!, m[1]!);
    }
    for (const [path, hex] of listed) {
      const b = i.files.get(path);
      if (!b) problems.push(`${path}: listed in SHA256SUMS but missing`);
      else if (createHash("sha256").update(b).digest("hex") !== hex) problems.push(`${path}: doesn't match its checksum`);
    }
    for (const path of i.files.keys()) if (path !== "SHA256SUMS" && !listed.has(path)) problems.push(`${path}: not in SHA256SUMS`);
    if (problems.length) return { ok: false, problems };
  }

  // 2. The package's own settings, for its chapters and title (Alembic rebuilds alembic.json).
  let given: Partial<WorkingManifestV3> = {};
  const raw = i.files.get("alembic.json");
  if (raw) {
    try { given = JSON.parse(new TextDecoder().decode(raw)) as Partial<WorkingManifestV3>; } catch { return { ok: false, problems: ["alembic.json isn't valid JSON"] }; }
  }
  // No chapter list: the chapters are the units that have their required documents (each study guide), titled and
  // ordered by the documents' own headers ("Chapter 6: Thermochemistry" → 6), so a package needn't carry a list.
  let chapters = (given.chapters ?? []).map((c) => ({ slug: c.slug, title: c.title }));
  if (!chapters.length) {
    const reserved = new Set(activeProfile.reservedUnitSlugs);
    // The document that names a chapter: its study guide (the first required part otherwise).
    const naming = activeProfile.unitParts.find((x) => x.id === "study-guide")?.id ?? activeProfile.requiredParts[0];
    const found = new Map<string, { title: string; n: number }>();
    for (const [p, b] of i.files) {
      const u = unitPartForPath(p);
      if (!u || reserved.has(u.slug) || u.part !== naming) continue;
      const header = /^\{\{nyml[\s\S]*?\ntitle:[ \t]*([^\n]+)/.exec(new TextDecoder().decode(b.subarray(0, 2000)))?.[1]?.trim();
      const num = /^(?:chapter|unit)\s+(\d+)/i.exec(header ?? "")?.[1];
      const title = (header ?? u.slug.replace(/-/g, " ")).replace(/^(?:chapter|unit)\s+\d+\s*[:.\-–—]\s*/i, "").slice(0, 200) || u.slug;
      found.set(u.slug, { title, n: num ? Number(num) : 1e6 });
    }
    chapters = [...found].sort(([a, x], [b, y]) => x.n - y.n || a.localeCompare(b)).map(([slug, v]) => ({ slug, title: v.title }));
  }
  const parsed = WorkingManifestV3Schema.safeParse({
    schemaVersion: 3, packageId: i.packageId, createdAt: new Date().toISOString(), type: DEFAULT_SITE_TYPE,
    title: i.title ?? given.title ?? "Imported course", license: i.license ?? given.license ?? "CC-BY-4.0",
    chapters,
    ...(given.description ? { description: given.description } : {}),
    ...(given.audience ? { audience: given.audience } : {}),
  });
  if (!parsed.success) return { ok: false, problems: [`the course settings can't be used: ${parsed.error.issues[0]?.message ?? "invalid"}`] };
  const manifest = parsed.data;

  // 3. Every file, checked as a write.
  const leftOut: ImportPlan["leftOut"] = [];
  const files: ImportPlan["files"] = [{ path: "alembic.json", text: `${JSON.stringify(manifest, null, 2)}\n` }];
  const slugs = new Set(manifest.chapters.map((c) => c.slug));
  for (const [rawPath, bytes] of [...i.files].sort(([a], [b]) => a.localeCompare(b))) {
    if (rawPath === "SHA256SUMS" || rawPath === "alembic.json") continue;
    let path: string;
    try { path = normalizePath(rawPath); } catch { leftOut.push({ path: rawPath, why: "a name Alembic can't accept" }); continue; }
    if (HIDDEN(path) || ALEMBIC_OWN(path)) { leftOut.push({ path, why: "Alembic's own files are never taken from a package" }); continue; }
    try { spaceForPathV3(path); assertPathAllowedInWorkingRepo(path); } catch { leftOut.push({ path, why: "outside the places this kind of course has" }); continue; }
    const part = unitPartForPath(path);
    if (part && !slugs.has(part.slug) && !activeProfile.reservedUnitSlugs.includes(part.slug)) { leftOut.push({ path, why: `belongs to a chapter "${part.slug}" the course doesn't list` }); continue; }
    if (bytes.length > MAX_UPLOAD_BYTES) { leftOut.push({ path, why: "larger than 4 MB" }); continue; }
    const kind = fileKind(path);
    if (kind === null) { leftOut.push({ path, why: "a kind of file a course can't hold" }); continue; }
    if (kind === "text" || /\.svg$/i.test(path)) {
      if (!isTextBytes(bytes)) { leftOut.push({ path, why: "isn't text" }); continue; }
      const text = new TextDecoder().decode(bytes);
      if (/\.svg$/i.test(path)) {
        const svg = svgProblems(text);
        if (svg.length) { leftOut.push({ path, why: svg[0]! }); continue; }
      }
      files.push({ path, text });
    } else {
      const m = mediaProblems(kind, bytes);
      if (m.length) { leftOut.push({ path, why: m[0]! }); continue; }
      files.push({ path, bytes });
    }
  }
  const inPlan = new Set(files.map((f) => f.path));
  const suggestedCompleted = [...new Set(i.ready ?? [])].filter((p) => inPlan.has(p) && isPage(p)).sort();
  return { ok: true, plan: { manifest, files, suggestedCompleted, leftOut } };
}
