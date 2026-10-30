/**
 * The site types Alembic carries (family docs/SITE-TYPE-CONTRACT.md §3): the
 * vendored definitions, checked when loaded. A definition that can't be
 * applied stops Alembic from starting rather than being half-applied. Pure.
 */
import { BUNDLED_TYPE_PACKAGES } from "./bundled.generated";
import { parseSiteType, type SiteType } from "./schema";

export { ALEMBIC_PATHS, parseSiteType, SITE_TYPE_SCHEMA, SiteTypeSchema, siteTypeProblems, type DocumentDefinition, type SiteType } from "./schema";
export { docKey, fillStarter, profileFromDefinition } from "./profile-bridge";

export interface LoadedSiteType {
  /** `type@major`, as a site records it in alembic.json. */
  readonly key: string;
  readonly definition: SiteType;
  /** The package's files (starters, licence texts, templates), by path. */
  readonly files: Readonly<Record<string, string>>;
  /** Where the copy came from (VENDOR.json). */
  readonly vendor: Readonly<Record<string, string>>;
}

function load(): ReadonlyMap<string, LoadedSiteType> {
  const out = new Map<string, LoadedSiteType>();
  for (const [key, pkg] of Object.entries(BUNDLED_TYPE_PACKAGES)) {
    const r = parseSiteType(pkg.definition);
    if (!r.ok) throw new Error(`site type ${key} can't be applied:\n- ${r.problems.join("\n- ")}`);
    for (const d of r.def.documents) if (d.starter && pkg.files[d.starter] === undefined) throw new Error(`site type ${key}: starter ${d.starter} is missing`);
    for (const c of r.def.licences?.choices ?? []) for (const f of Object.values(c.files)) if (pkg.files[f] === undefined) throw new Error(`site type ${key}: licence text ${f} is missing`);
    if (r.def.licences?.citation && pkg.files[r.def.licences.citation.template] === undefined) throw new Error(`site type ${key}: the citation template is missing`);
    out.set(key, { key, definition: r.def, files: pkg.files, vendor: pkg.vendor });
  }
  return out;
}

export const SITE_TYPES: ReadonlyMap<string, LoadedSiteType> = load();

/** The site type a new site gets, and (for now) every site: the Coursewerk OER course type. */
export const DEFAULT_SITE_TYPE = "oer-course@1";

export function siteType(key: string): LoadedSiteType {
  const t = SITE_TYPES.get(key);
  if (!t) throw new Error(`Alembic doesn't carry site type ${key}`);
  return t;
}
