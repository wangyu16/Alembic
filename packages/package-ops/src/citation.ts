import { isOpenLicense, type PackageManifest } from "@alembic/package-contract";

/**
 * Citation (M15.3). Generate a `CITATION.cff` so a snapshot is citable
 * scholarly output (good OER practice + an educator-adoption incentive). Pure:
 * the caller supplies the version (snapshot tag), author, URL, and date.
 */
export interface CitationInput {
  /** Snapshot version, e.g. the tag "fall-2026" (omit for the head). */
  version?: string;
  /** Author display name (e.g. the GitHub owner login). */
  authorName: string;
  /** Canonical URL (public repo, or a snapshot/tag URL). */
  url: string;
  /** Release date, ISO `YYYY-MM-DD` (passed in — keep this function pure). */
  dateReleased: string;
}

/** YAML double-quoted scalar (JSON string syntax is valid YAML). */
const y = (s: string) => JSON.stringify(s);

export function generateCitationCff(
  manifest: Pick<PackageManifest, "title" | "description" | "license">,
  input: CitationInput,
): string {
  const lines = [
    "cff-version: 1.2.0",
    "message: " + y("If you use this open educational resource, please cite it."),
    "type: dataset",
    "title: " + y(manifest.title),
  ];
  if (manifest.description) lines.push("abstract: " + y(manifest.description));
  lines.push("authors:", "  - name: " + y(input.authorName));
  if (input.version) lines.push("version: " + y(input.version));
  // The open manifest.license values (CC-BY-4.0, …) are SPDX identifiers; CFF's
  // `license` expects one. An unlicensed package has no SPDX id — omit the field.
  if (isOpenLicense(manifest.license)) lines.push("license: " + manifest.license);
  lines.push("date-released: " + y(input.dateReleased));
  lines.push("url: " + y(input.url));
  return lines.join("\n") + "\n";
}

/**
 * Human-readable "how to cite" lines for Discover's course and element pages
 * (Phase 5 Track A.4). Pure: the caller passes the public facts. APA-like,
 * one line, no markup — the page shows it as selectable text.
 */
export interface CourseCitationInput {
  title: string;
  /** Instructor name(s) if the course states them, else the publisher handle. */
  author: string;
  /** Year of the version being cited (last update). */
  year: number;
  /** The stable course page (permalink), absolute. */
  url: string;
  licenseLabel: string;
}

export function formatCourseCitation(c: CourseCitationInput): string {
  const author = c.author.trim() || "Anonymous";
  const lic = c.licenseLabel.trim();
  return `${author} (${c.year}). ${c.title.trim()} [Open educational resource]. ${c.url}${
    lic ? ` — ${lic}` : ""
  }`;
}

export interface ElementCitationInput {
  title: string;
  courseTitle: string;
  author: string;
  year: number;
  /** The element's permalink (`/d/{docId}`), absolute. */
  url: string;
  licenseLabel: string;
}

export function formatElementCitation(e: ElementCitationInput): string {
  const author = e.author.trim() || "Anonymous";
  const lic = e.licenseLabel.trim();
  return `${author} (${e.year}). ${e.title.trim()}. In ${e.courseTitle.trim()} [Open educational resource]. ${e.url}${
    lic ? ` — ${lic}` : ""
  }`;
}
