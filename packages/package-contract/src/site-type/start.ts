/**
 * The files a new site starts with, from its type definition (family
 * docs/SITE-TYPE-CONTRACT.md §5): the template's files, the required site
 * documents from their starters, the chosen licence's files, and the citation.
 * Pure: the definition's files come in as data.
 */
import { fillStarter } from "./profile-bridge";
import type { SiteType } from "./schema";

export interface SiteStart {
  title: string;
  /** The licence choice's id (as stored in alembic.json). */
  licence: string;
  /** Who the citation credits (the owner's name). */
  authors: string;
  year: number;
  /** The website's address, if known yet (else its line is left out). */
  url?: string;
  /** Mints a document id for each started document. */
  newUid: () => string;
}

/** A value for inside YAML double quotes (JSON's escaping is valid YAML there). */
const yamlQuoted = (s: string) => JSON.stringify(s).slice(1, -1);

/**
 * Fill the citation template: placeholders become their values, escaped for YAML double quotes when quoted, and a line
 * whose placeholder has no value (`{{licence}}` for a licence that isn't open, `{{url}}` before the site exists) is left
 * out rather than written empty (an empty value isn't valid CFF; Coursewerk's note, 2026-10-30).
 */
export function fillCitation(template: string, values: Record<"title" | "authors" | "licence" | "year" | "url", string>): string {
  const out: string[] = [];
  for (const line of template.split("\n")) {
    const names = [...line.matchAll(/\{\{(title|authors|licence|year|url)\}\}/g)].map((m) => m[1] as keyof typeof values);
    if (names.some((n) => !values[n])) continue;
    out.push(line.replace(/("?)\{\{(title|authors|licence|year|url)\}\}("?)/g, (_m, open: string, name: keyof typeof values, close: string) =>
      open && close ? `"${yamlQuoted(values[name])}"` : `${open}${values[name].replace(/[\r\n]+/g, " ")}${close}`));
  }
  return out.join("\n");
}

/** Every file a new site starts with besides alembic.json and its units' documents (path → text). */
export function siteStartFiles(def: SiteType, files: Readonly<Record<string, string>>, s: SiteStart): Map<string, string> {
  const out = new Map<string, string>();
  // The template, copied once.
  const prefix = (def.template ?? "").replace(/\/?$/, "/");
  if (def.template) for (const [path, text] of Object.entries(files)) if (path.startsWith(prefix)) out.set(path.slice(prefix.length), text);
  // Required site documents, from their starters (a document without a starter begins with its header only).
  for (const d of def.documents) {
    if (d.scope !== "site" || !d.required) continue;
    const starter = d.starter ? files[d.starter] : undefined;
    out.set(d.path, starter !== undefined ? fillStarter(starter, s.title, s.newUid(), "Untitled") : `{{nyml\nkind: document\nformat: 1\ntitle: ${fillStarter("{{title}}", s.title, "", "Untitled")}\nuid: ${s.newUid()}\n}}\n`);
  }
  // The licence's files and the citation.
  const choice = def.licences?.choices.find((c) => c.id === s.licence);
  if (choice) for (const [name, file] of Object.entries(choice.files)) if (files[file] !== undefined) out.set(name, files[file]!);
  const citation = def.licences?.citation;
  if (citation && files[citation.template] !== undefined) {
    out.set(citation.file, fillCitation(files[citation.template]!, {
      title: s.title, authors: s.authors, licence: choice?.open ? choice.id : "", year: String(s.year), url: s.url ?? "",
    }));
  }
  return out;
}
