/**
 * The site type definition, schema 1 (family docs/SITE-TYPE-CONTRACT.md §5):
 * what a type package (Coursewerk first) declares about one kind of website.
 * Alembic owns this schema; the type package owns the data. Pure.
 *
 * `SiteTypeSchema` checks the shape; `siteTypeProblems` adds the cross-field
 * rules of §5 "Validation". A definition must pass both before Alembic
 * applies it.
 */
import { z } from "zod";

export const SITE_TYPE_SCHEMA = "alembic.site-type/1";

const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "an id is lowercase letters, digits and single hyphens").max(60);
const Label = z.string().min(1).max(80);
/** A path or path pattern inside a site: relative, no `..`, no leading or trailing slash unless a folder pattern. */
const SitePath = z.string().min(1).max(200).regex(/^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f]+$/, "a relative path");
/** A file inside the type package (starters, licence texts, templates). */
const PackageFile = SitePath;

export const Who = z.enum(["editor", "lead", "fixed"]);
export const Edits = z.enum(["sections", "whole", "keep-both"]);
export const Format = z.enum(["md", "slides", "paged"]);

const DocumentDef = z.object({
  id: Id,
  scope: z.enum(["unit", "site"]),
  label: Label,
  path: SitePath,
  format: Format,
  required: z.boolean().optional(),
  starter: PackageFile.optional(),
  group: Id,
  edits: Edits.optional(),
  who: Who.optional(),
}).strict();

const UnitFolderDef = z.object({
  path: SitePath,
  group: Id,
  edits: Edits.optional(),
}).strict();

const FrontEntry = z.discriminatedUnion("show", [
  z.object({ show: z.literal("title") }).strict(),
  z.object({ show: z.literal("detail"), id: Id }).strict(),
  z.object({ show: z.literal("units") }).strict(),
  z.object({ show: z.literal("link"), doc: Id }).strict(),
  z.object({ show: z.literal("doc"), doc: Id }).strict(),
  z.object({ show: z.literal("term") }).strict(),
]);

export const SiteTypeSchema = z.object({
  schema: z.literal(SITE_TYPE_SCHEMA),
  type: Id,
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "a semantic version"),
  names: z.object({ site: Label, unit: Label.optional(), units: Label.optional() }).strict(),
  units: z.object({ first: z.string().min(1).max(200) }).strict().optional(),
  documents: z.array(DocumentDef).min(1).max(100),
  unitFolders: z.array(UnitFolderDef).max(50).optional(),
  groups: z.array(z.object({ id: Id, label: Label }).strict()).min(1).max(20),
  relations: z.array(z.object({ from: Id, to: Id, kind: z.enum(["plans", "pairs"]) }).strict()).max(100).optional(),
  rootFiles: z.array(z.object({ name: z.string().regex(/^[^/]+$/), who: Who }).strict()).max(50).optional(),
  folders: z.array(z.object({ path: SitePath, who: Who }).strict()).max(50).optional(),
  figures: z.object({ public: SitePath, private: SitePath }).strict().optional(),
  private: z.array(z.object({ path: SitePath, who: Who }).strict()).max(50).optional(),
  records: z.object({ private: SitePath, public: SitePath }).strict().optional(),
  details: z.array(z.object({ id: Id, label: Label, type: z.enum(["line", "text", "url"]), max: z.number().int().min(1).max(10_000) }).strict()).max(20).optional(),
  licences: z.object({
    choices: z.array(z.object({
      id: z.string().regex(/^[A-Za-z0-9.-]+$/).max(40),
      label: Label.max(120),
      open: z.boolean(),
      files: z.record(z.string().regex(/^[^/]+$/), PackageFile),
    }).strict()).min(1).max(30),
    default: z.string(),
    citation: z.object({ file: z.string().regex(/^[^/]+$/), template: PackageFile }).strict().optional(),
  }).strict().optional(),
  template: PackageFile.optional(),
  website: z.object({
    front: z.array(FrontEntry).max(30).optional(),
    unitLinks: z.array(Id).max(30).optional(),
  }).strict().optional(),
}).strict();

export type SiteType = z.infer<typeof SiteTypeSchema>;
export type DocumentDefinition = z.infer<typeof DocumentDef>;

/** Alembic's own paths (§4): in every site, never placed by a definition. */
export const ALEMBIC_PATHS = ["alembic.json", ".alembic/", ".github/", ".gitignore", "private/sources/"] as const;
/** Reserved at the root for the website's front page (§5 website.front). */
const RESERVED_ROOT = ["index.md", "index.html"];

const placeholders = (p: string) => [...p.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]!);
const under = (path: string, folder: string) => path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
const touchesAlembic = (path: string) => ALEMBIC_PATHS.some((a) => (a.endsWith("/") ? under(path, a.slice(0, -1)) || path.startsWith(a) : path === a));

/** The cross-field rules (§5 "Validation"); empty when the definition can be applied. */
export function siteTypeProblems(def: SiteType): string[] {
  const out: string[] = [];
  const hasUnits = def.names.unit !== undefined;
  const docIds = new Set<string>();
  for (const d of def.documents) {
    if (docIds.has(d.id)) out.push(`document id "${d.id}" is used twice`);
    docIds.add(d.id);
  }
  const groupIds = new Set(def.groups.map((g) => g.id));
  if (groupIds.size !== def.groups.length) out.push("a group id is used twice");

  // Units: only with a unit name.
  if (!hasUnits) {
    if (def.documents.some((d) => d.scope === "unit")) out.push("unit documents need names.unit");
    if (def.units) out.push("units needs names.unit");
    if (def.unitFolders?.length) out.push("unitFolders need names.unit");
    if (def.website?.unitLinks?.length) out.push("unitLinks need names.unit");
    if (def.website?.front?.some((e) => e.show === "units")) out.push('front entry "units" needs names.unit');
  }

  // Patterns: {unit} only in unit documents and unit folders (exactly once), {doc} only in figures; {term} only in add-ons.
  for (const d of def.documents) {
    const ph = placeholders(d.path);
    if (d.scope === "unit" && (ph.length !== 1 || ph[0] !== "unit")) out.push(`unit document "${d.id}": its path needs {unit} once`);
    if (d.scope === "site" && ph.length) out.push(`site document "${d.id}": its path may not use placeholders`);
    const ending = d.format === "slides" ? ".slides.md" : d.format === "paged" ? ".paged.md" : ".md";
    if (!d.path.endsWith(ending)) out.push(`document "${d.id}": a ${d.format} path ends with ${ending}`);
    if (d.format === "md" && /\.(slides|paged)\.md$/.test(d.path)) out.push(`document "${d.id}": an md path can't end with .slides.md or .paged.md`);
    if (!groupIds.has(d.group)) out.push(`document "${d.id}": unknown group "${d.group}"`);
    if (d.scope === "site" && !d.path.includes("/") && RESERVED_ROOT.includes(d.path)) out.push(`document "${d.id}": ${d.path} is reserved for the front page`);
  }
  for (const f of def.unitFolders ?? []) {
    const ph = placeholders(f.path);
    if (ph.length !== 1 || ph[0] !== "unit" || !f.path.endsWith("{unit}/")) out.push(`unit folder ${f.path}: it ends with {unit}/`);
    if (!groupIds.has(f.group)) out.push(`unit folder ${f.path}: unknown group "${f.group}"`);
  }
  if (def.figures) for (const [k, p] of Object.entries(def.figures)) {
    const ph = placeholders(p);
    if (ph.length !== 1 || ph[0] !== "doc" || !p.endsWith("{doc}")) out.push(`figures.${k}: it ends with {doc}`);
  }
  if (def.figures && !def.figures.private.startsWith("private/")) out.push("figures.private must be under private/");
  if (def.figures && def.figures.public.startsWith("private/")) out.push("figures.public can't be under private/");
  const others = [...(def.folders ?? []).map((f) => f.path), ...(def.private ?? []).map((p) => p.path), ...(def.rootFiles ?? []).map((r) => r.name)];
  if (def.records) others.push(def.records.private, def.records.public);
  for (const p of others) if (placeholders(p).length) out.push(`${p}: only documents, unit folders and figures use placeholders`);

  // Privacy by place.
  for (const p of def.private ?? []) if (!under(p.path, "private")) out.push(`private entry ${p.path} must be under private/`);
  for (const f of def.folders ?? []) if (under(f.path, "private")) out.push(`folder ${f.path} is under private/: declare it in private`);
  if (def.records) {
    if (!under(def.records.private, "private")) out.push("records.private must be under private/");
    if (under(def.records.public, "private")) out.push("records.public can't be under private/");
  }

  // Alembic's paths and the front page are off limits.
  const allPaths = [...def.documents.map((d) => d.path), ...(def.unitFolders ?? []).map((f) => f.path), ...others];
  for (const p of allPaths) if (touchesAlembic(p)) out.push(`${p} falls under Alembic's own paths`);
  for (const r of def.rootFiles ?? []) if (RESERVED_ROOT.includes(r.name)) out.push(`root file ${r.name} is reserved for the front page`);

  // References name something declared.
  for (const r of def.relations ?? []) for (const id of [r.from, r.to]) if (!docIds.has(id)) out.push(`relation names unknown document "${id}"`);
  for (const id of def.website?.unitLinks ?? []) {
    const d = def.documents.find((x) => x.id === id);
    if (!d || d.scope !== "unit") out.push(`unitLinks names "${id}", not a unit document`);
  }
  const detailIds = new Set((def.details ?? []).map((d) => d.id));
  for (const e of def.website?.front ?? []) {
    if (e.show === "detail" && !detailIds.has(e.id)) out.push(`front names unknown detail "${e.id}"`);
    if ((e.show === "link" || e.show === "doc") && def.documents.find((d) => d.id === e.doc)?.scope !== "site") out.push(`front names "${e.doc}", not a site document`);
    if (e.show === "term") out.push('front entry "term" needs an add-on that declares terms');
  }

  // Licences: files are root files nothing else places, named LICENSE or with an accepted text ending.
  if (def.licences) {
    const ids = def.licences.choices.map((c) => c.id);
    if (new Set(ids).size !== ids.length) out.push("a licence id is used twice");
    if (!ids.includes(def.licences.default)) out.push(`licences.default "${def.licences.default}" is not a choice`);
    const placed = new Set([...def.documents.map((d) => d.path), ...(def.rootFiles ?? []).map((r) => r.name)]);
    const names = new Set<string>();
    for (const c of def.licences.choices) for (const name of Object.keys(c.files)) names.add(name);
    if (def.licences.citation) names.add(def.licences.citation.file);
    for (const n of names) {
      if (placed.has(n)) out.push(`licence file ${n} is also placed by something else`);
      if (n !== "LICENSE" && !/\.(md|txt|cff)$/.test(n)) out.push(`licence file ${n}: name it LICENSE or give it an accepted text ending`);
      if (touchesAlembic(n) || RESERVED_ROOT.includes(n)) out.push(`licence file ${n} is reserved`);
    }
  }
  return out;
}

/** The definition, checked: the shape and the cross-field rules. */
export function parseSiteType(raw: unknown): { ok: true; def: SiteType } | { ok: false; problems: string[] } {
  const r = SiteTypeSchema.safeParse(raw);
  if (!r.success) return { ok: false, problems: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  const problems = siteTypeProblems(r.data);
  return problems.length ? { ok: false, problems } : { ok: true, def: r.data };
}
