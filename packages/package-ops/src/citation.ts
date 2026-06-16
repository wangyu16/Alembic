import type { PackageManifest } from "@alembic/package-contract";

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
  // manifest.license values (CC-BY-4.0, …) are SPDX identifiers.
  lines.push("license: " + manifest.license);
  lines.push("date-released: " + y(input.dateReleased));
  lines.push("url: " + y(input.url));
  return lines.join("\n") + "\n";
}
